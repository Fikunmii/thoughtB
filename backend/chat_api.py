"""
chat_api.py — Concept-aware chat with the user's own journal.

Grounded RAG over the user's entries:
  1. Full-text search via the existing `entry_content` Lucene index,
     scoped to the user (Entry.user_id).
  2. Concept-tension context: CONTRADICTS edges among the concepts that
     surface in the retrieved entries.
  3. Claude streams an answer grounded strictly in those excerpts,
     citing inline as [Entry · YYYY-MM-DD].

Conversations persist in Neo4j:
  (:User)-[:HAS_CHAT_SESSION]->(:ChatSession)-[:HAS_MESSAGE]->(:ChatMessage)
  (:ChatMessage)-[:CITED]->(:Entry)

Free tier: CHAT_FREE_TIER_LIMIT messages/month (402 + upgrade prompt),
checked the same way as the 30-entry limit in api.py.

Registered from api.py (alongside the other register_* calls):
    try:
        from chat_api import register_chat_routes
        register_chat_routes(app)
        print("✓ chat routes registered")
    except Exception as e:
        print(f"⚠ chat_api not loaded: {e}")
"""

import os
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

CHAT_MODEL = os.getenv("CHAT_MODEL", "claude-sonnet-4-6")
MAX_CONTEXT_ENTRIES = int(os.getenv("CHAT_MAX_CONTEXT_ENTRIES", "8"))
MAX_HISTORY_TURNS = int(os.getenv("CHAT_MAX_HISTORY_TURNS", "6"))
FREE_TIER_MONTHLY_LIMIT = int(os.getenv("CHAT_FREE_TIER_LIMIT", "15"))

# Set by register_chat_routes() from the shared instances already created in
# api.py, so this module doesn't open a second Neo4j connection pool
# (Aura Free has a tight concurrent-connection cap) or a second Anthropic client.
driver = None
claude = None


# ── Request models (inline, matching api.py style) ────────────────────────────
class ChatSessionCreate(BaseModel):
    title: Optional[str] = "New conversation"


class ChatMessageIn(BaseModel):
    content: str


# ── Helpers ───────────────────────────────────────────────────────────────────
def serialize_dt(val):
    """Convert Neo4j DateTime to clean ISO format JS can parse (same as api.py)."""
    if val is None:
        return None
    s = str(val)
    s = re.sub(r"(\.\d{3})\d+([\+\-Z])", r"\1\2", s)
    s = re.sub(r"(\.\d{3})\d+$", r"\1", s)
    return s


def _esc_lucene(q: str) -> str:
    """Escape Lucene special characters for db.index.fulltext.queryNodes."""
    return re.sub(r"([\+\-\!\(\)\{\}\[\]\^\"~\*\?\:\\/])", r"\\\1", q)


def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


# ── Schema setup ──────────────────────────────────────────────────────────────
def _ensure_chat_schema():
    stmts = [
        "CREATE CONSTRAINT chat_session_id IF NOT EXISTS FOR (s:ChatSession) REQUIRE s.id IS UNIQUE",
        "CREATE CONSTRAINT chat_message_id IF NOT EXISTS FOR (m:ChatMessage) REQUIRE m.id IS UNIQUE",
    ]
    with driver.session() as s:
        for st in stmts:
            try:
                s.run(st)
            except Exception:
                pass


# ── Retrieval ─────────────────────────────────────────────────────────────────
def retrieve_context(uid: str, question: str) -> dict:
    """Top-k entry excerpts (Lucene FTS on entry_content) + concept tensions."""
    q = _esc_lucene(question.strip())
    excerpts: List[dict] = []
    tensions: List[dict] = []

    with driver.session() as s:
        res = s.run(
            """
            CALL db.index.fulltext.queryNodes('entry_content', $q) YIELD node, score
            WHERE node.user_id = $uid
            RETURN node.id AS id, node.content AS content,
                   node.created_at AS created_at, score
            ORDER BY score DESC
            LIMIT $limit
            """,
            q=q, uid=uid, limit=MAX_CONTEXT_ENTRIES,
        )
        for r in res:
            excerpts.append({
                "id": r["id"],
                "date": (serialize_dt(r["created_at"]) or "")[:10] or "undated",
                "text": _clip(r["content"] or "", 1200),
            })

        if not excerpts:
            # Cold start: give Claude the most recent entries instead
            res = s.run(
                """
                MATCH (e:Entry {user_id: $uid})
                RETURN e.id AS id, e.content AS content, e.created_at AS created_at
                ORDER BY e.created_at DESC LIMIT 3
                """,
                uid=uid,
            )
            for r in res:
                excerpts.append({
                    "id": r["id"],
                    "date": (serialize_dt(r["created_at"]) or "")[:10] or "undated",
                    "text": _clip(r["content"] or "", 1200),
                })

        entry_ids = [e["id"] for e in excerpts]
        if entry_ids:
            res = s.run(
                """
                UNWIND $ids AS entryId
                MATCH (:Entry {id: entryId})-[:SURFACES]->(c:Concept {user_id: $uid})
                WITH COLLECT(DISTINCT c.label) AS labels
                UNWIND labels AS a
                UNWIND labels AS b
                MATCH (c1:Concept {label: a, user_id: $uid})-[r:CONTRADICTS]-(c2:Concept {label: b, user_id: $uid})
                WHERE a < b AND NOT coalesce(r.resolved, false)
                RETURN DISTINCT a AS c1, b AS c2
                LIMIT 5
                """,
                ids=entry_ids, uid=uid,
            )
            tensions = [{"c1": r["c1"], "c2": r["c2"]} for r in res]

    return {"excerpts": excerpts, "tensions": tensions}


SYSTEM_PROMPT = """You are the ThoughtB assistant — an AI that helps the user explore their own journal. You are given excerpts from their entries and concept-graph context.

Rules:
1. Ground every claim in the provided excerpts. Never invent entries, events, or feelings.
2. Cite inline as [Entry · YYYY-MM-DD] using each excerpt's date.
3. If the excerpts don't contain the answer, say so plainly and suggest what the user could journal about — do not answer from general knowledge as if it were their life.
4. You may notice patterns, drift, and tensions across excerpts — name them. Be warm but direct.
5. Keep answers focused: 2-6 paragraphs unless the user asks for depth."""


def _build_context_block(ctx: dict) -> str:
    parts = [f"[Entry {i} · {e['date']}]\n{e['text']}" for i, e in enumerate(ctx["excerpts"], 1)]
    block = "\n\n---\n\n".join(parts)
    if ctx["tensions"]:
        t = "; ".join(f"{x['c1']} ↔ {x['c2']}" for x in ctx["tensions"])
        block += f"\n\n---\n\nActive tensions in the user's concept graph: {t}"
    return block or "(no journal excerpts found)"


# ── Persistence ───────────────────────────────────────────────────────────────
def _create_session(uid: str, title: str) -> dict:
    sid = str(uuid.uuid4())
    with driver.session() as s:
        s.run(
            """
            MATCH (u:User {id: $uid})
            CREATE (u)-[:HAS_CHAT_SESSION]->(sess:ChatSession {
                id: $sid, title: $title, created_at: datetime(), updated_at: datetime()
            })
            """,
            uid=uid, sid=sid, title=title,
        )
    return {"id": sid, "title": title}


def _list_sessions(uid: str) -> List[dict]:
    with driver.session() as s:
        res = s.run(
            """
            MATCH (:User {id: $uid})-[:HAS_CHAT_SESSION]->(sess:ChatSession)
            OPTIONAL MATCH (sess)-[:HAS_MESSAGE]->(m:ChatMessage)
            RETURN sess.id AS id, sess.title AS title,
                   COUNT(m) AS message_count, sess.updated_at AS updated_at
            ORDER BY updated_at DESC
            """,
            uid=uid,
        )
        return [
            {
                "id": r["id"],
                "title": r["title"],
                "message_count": r["message_count"],
                "updated_at": serialize_dt(r["updated_at"]),
            }
            for r in res
        ]


def _assert_owns_session(uid: str, sid: str) -> None:
    with driver.session() as s:
        ok = s.run(
            """
            MATCH (:User {id: $uid})-[:HAS_CHAT_SESSION]->(sess:ChatSession {id: $sid})
            RETURN count(sess) AS n
            """,
            uid=uid, sid=sid,
        ).single()
    if not ok or ok["n"] == 0:
        raise HTTPException(status_code=404, detail="Session not found")


def _session_messages(uid: str, sid: str) -> List[dict]:
    _assert_owns_session(uid, sid)
    with driver.session() as s:
        res = s.run(
            """
            MATCH (:ChatSession {id: $sid})-[:HAS_MESSAGE]->(m:ChatMessage)
            OPTIONAL MATCH (m)-[:CITED]->(e:Entry)
            RETURN m.id AS id, m.role AS role, m.content AS content,
                   m.created_at AS created_at, COLLECT(e.id) AS cited_ids
            ORDER BY m.created_at ASC
            """,
            sid=sid,
        )
        return [
            {
                "id": r["id"],
                "role": r["role"],
                "content": r["content"],
                "created_at": serialize_dt(r["created_at"]),
                "cited_ids": [c for c in r["cited_ids"] if c],
            }
            for r in res
        ]


def _get_history(sid: str) -> List[dict]:
    with driver.session() as s:
        res = s.run(
            """
            MATCH (:ChatSession {id: $sid})-[:HAS_MESSAGE]->(m:ChatMessage)
            RETURN m.role AS role, m.content AS content
            ORDER BY m.created_at DESC LIMIT $limit
            """,
            sid=sid, limit=MAX_HISTORY_TURNS,
        )
        rows = [{"role": r["role"], "content": r["content"]} for r in res]
    rows.reverse()
    return rows


def _save_message(sid: str, role: str, content: str, citations: Optional[List[str]] = None) -> str:
    mid = str(uuid.uuid4())
    with driver.session() as s:
        s.run(
            """
            MATCH (sess:ChatSession {id: $sid})
            CREATE (sess)-[:HAS_MESSAGE]->(m:ChatMessage {
                id: $mid, role: $role, content: $content, created_at: datetime()
            })
            SET sess.updated_at = datetime()
            """,
            sid=sid, mid=mid, role=role, content=content,
        )
        for eid in (citations or []):
            s.run(
                """
                MATCH (m:ChatMessage {id: $mid}), (e:Entry {id: $eid})
                MERGE (m)-[:CITED]->(e)
                """,
                mid=mid, eid=eid,
            )
    return mid


def _delete_session(uid: str, sid: str) -> None:
    with driver.session() as s:
        s.run(
            """
            MATCH (:User {id: $uid})-[:HAS_CHAT_SESSION]->(sess:ChatSession {id: $sid})
            OPTIONAL MATCH (sess)-[:HAS_MESSAGE]->(m:ChatMessage)
            DETACH DELETE m, sess
            """,
            uid=uid, sid=sid,
        )


def _free_tier_remaining(uid: str) -> int:
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    with driver.session() as s:
        r = s.run(
            """
            MATCH (:User {id: $uid})-[:HAS_CHAT_SESSION]->(:ChatSession)
                  -[:HAS_MESSAGE]->(m:ChatMessage)
            WHERE m.role = 'user' AND m.created_at >= datetime($month_start)
            RETURN COUNT(m) AS used
            """,
            uid=uid, month_start=month_start.isoformat(),
        ).single()
    return max(0, FREE_TIER_MONTHLY_LIMIT - (r["used"] if r else 0))


def _user_access(uid: str) -> dict:
    """
    Same pattern as the /entries gate in api.py: full unlimited access requires
    plan != free AND a healthy subscription status. A lapsed trial or failed
    renewal (past_due/unpaid) — or a canceled sub, which the webhook already
    resets to plan='free' — falls back to the free-tier message cap instead of
    an unconditional block, so access resumes automatically once Stripe
    successfully charges again and status flips back to active.
    """
    with driver.session() as s:
        r = s.run(
            "MATCH (u:User {id: $uid}) "
            "RETURN coalesce(u.plan, 'free') AS plan, coalesce(u.subscription_status, 'active') AS status",
            uid=uid,
        ).single()
    plan = r["plan"] if r else "free"
    status = r["status"] if r else "active"
    return {
        "plan": plan,
        "status": status,
        "has_full_access": plan != "free" and status in ("active", "trialing"),
    }


def _user_plan(uid: str) -> str:
    return _user_access(uid)["plan"]


# ── Route registrar ───────────────────────────────────────────────────────────
def register_chat_routes(app):
    from auth import get_current_user  # local import avoids circulars, same as other modules

    global driver, claude
    if driver is None or claude is None:
        import api as _api  # deferred: api.py is mid-import when this runs, but
        driver = _api.driver  # by this point (called from api.py's own body,
        claude = _api.claude  # after both clients are constructed) both exist.

    _ensure_chat_schema()

    @app.post("/chat/sessions", tags=["chat"])
    def create_session(
        body: ChatSessionCreate,
        current_user: dict = Depends(get_current_user),
    ):
        return _create_session(current_user["user_id"], body.title or "New conversation")

    @app.get("/chat/sessions", tags=["chat"])
    def list_sessions(current_user: dict = Depends(get_current_user)):
        return _list_sessions(current_user["user_id"])

    @app.get("/chat/sessions/{sid}/messages", tags=["chat"])
    def get_messages(sid: str, current_user: dict = Depends(get_current_user)):
        return _session_messages(current_user["user_id"], sid)

    @app.delete("/chat/sessions/{sid}", tags=["chat"])
    def delete_session(sid: str, current_user: dict = Depends(get_current_user)):
        _assert_owns_session(current_user["user_id"], sid)
        _delete_session(current_user["user_id"], sid)
        return {"status": "deleted"}

    @app.get("/chat/quota", tags=["chat"])
    def quota(current_user: dict = Depends(get_current_user)):
        uid = current_user["user_id"]
        access = _user_access(uid)
        capped = not access["has_full_access"]
        return {
            "plan": access["plan"],
            "status": access["status"],
            "trial_ended": access["plan"] != "free" and access["status"] in ("past_due", "unpaid"),
            "limit": FREE_TIER_MONTHLY_LIMIT if capped else None,
            "remaining": _free_tier_remaining(uid) if capped else None,
        }

    @app.post("/chat/sessions/{sid}/messages", tags=["chat"])
    def send_message(
        sid: str,
        body: ChatMessageIn,
        current_user: dict = Depends(get_current_user),
    ):
        uid = current_user["user_id"]

        _assert_owns_session(uid, sid)

        # Gating — same pattern as the 30-entry limit in api.py. A lapsed trial or
        # failed renewal falls back to the free-tier cap rather than a hard block,
        # so chat resumes automatically once Stripe successfully charges again.
        access = _user_access(uid)
        if not access["has_full_access"]:
            remaining = _free_tier_remaining(uid)
            if remaining <= 0:
                if access["plan"] != "free" and access["status"] in ("past_due", "unpaid"):
                    raise HTTPException(
                        status_code=402,
                        detail={
                            "reason": "trial_ended",
                            "message": "Your free trial has ended and your last payment didn't go "
                            "through. Update your card to keep chatting with your journal.",
                        },
                    )
                raise HTTPException(
                    status_code=402,
                    detail={
                        "reason": "limit_reached",
                        "message": f"Free tier includes {FREE_TIER_MONTHLY_LIMIT} chat messages "
                        f"per month. Upgrade to Personal to keep chatting with your journal.",
                    },
                )

        question = body.content.strip()
        if not question:
            raise HTTPException(status_code=400, detail="Message is empty")

        history = _get_history(sid)
        ctx = retrieve_context(uid, question)
        _save_message(sid, "user", question)

        def generate():
            full: List[str] = []
            try:
                with claude.messages.stream(
                    model=CHAT_MODEL,
                    max_tokens=1024,
                    system=f"{SYSTEM_PROMPT}\n\nJournal excerpts for grounding:\n{_build_context_block(ctx)}",
                    messages=[{"role": h["role"], "content": h["content"]} for h in history]
                    + [{"role": "user", "content": question}],
                ) as stream:
                    for chunk in stream.text_stream:
                        full.append(chunk)
                        yield chunk
            except Exception as e:  # keep the stream alive; error surfaces in the reply
                yield f"\n\n[error] {e}"
            finally:
                _save_message(sid, "assistant", "".join(full), citations=[e["id"] for e in ctx["excerpts"]])

        return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")
