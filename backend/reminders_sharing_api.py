"""
reminders_sharing_api.py — Reminders, prompts, and sharing backend
Registers:
  /reminders/* — Reflection prompts, weekly digest, settings
  /shares/*    — Create/revoke read-only share links
  /shared/*    — Public shared graph viewer endpoint (no auth required)
"""
from neo4j import GraphDatabase
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from neo4j import GraphDatabase
import anthropic
import os, uuid, json
from datetime import datetime, timedelta
from auth import get_current_user, get_user_by_id
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(tags=["reminders_sharing"])

NEO4J_URI  = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "yourpassword")
driver     = GraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASSWORD)
)
client     = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


# ─────────────────────────────────────────────────────────────────────────────
# REMINDERS
# ─────────────────────────────────────────────────────────────────────────────

class ReminderSettings(BaseModel):
    weekly_email: bool = False
    in_app:       bool = True
    frequency:    str  = "weekly"   # daily | weekly | biweekly


@router.get("/reminders/prompts")
def get_prompts(current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    prompts = generate_prompts(uid)
    return {"prompts": prompts}


@router.post("/reminders/generate")
def regenerate_prompts(current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    prompts = generate_prompts(uid, force=True)
    return {"prompts": prompts}


@router.get("/reminders/digest")
def get_digest(current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    return build_digest(uid)


@router.put("/reminders/settings")
def update_settings(settings: ReminderSettings, current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with driver.session() as session:
        session.run("""
            MATCH (u:User {id: $uid})
            SET u.reminder_settings = $settings
        """, uid=uid, settings=json.dumps(settings.dict()))
    return {"status": "saved"}


def generate_prompts(user_id: str, force: bool = False) -> list[dict]:
    """Generate AI-powered reflection prompts from the user's graph state."""
    with driver.session() as session:
        # Gather signals from the graph
        contradictions = list(session.run("""
            MATCH (c1:Concept)-[r:CONTRADICTS]->(c2:Concept)
            WHERE r.user_id = $uid AND r.resolved = false
            RETURN c1.label AS c1, c2.label AS c2, r.tension_score AS score
            ORDER BY r.tension_score DESC LIMIT 3
        """, uid=user_id))

        drifting = list(session.run("""
            MATCH (c:Concept)-[:BELONGS_TO]->(:User {id: $uid})
            WHERE c.stability_score < 0.65
            RETURN c.label AS label, c.stability_score AS stability
            ORDER BY c.stability_score ASC LIMIT 3
        """, uid=user_id))

        silent_concepts = list(session.run("""
            MATCH (c:Concept)-[:BELONGS_TO]->(:User {id: $uid})
            WHERE c.is_core = true
            AND NOT (c)-[:MENTIONED_IN]-(:Entry {recent: true})
            RETURN c.label AS label LIMIT 3
        """, uid=user_id))

        open_questions = list(session.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid})
            WHERE e.open_question IS NOT NULL
            MATCH (e)-[:SURFACES]->(c:Concept)
            RETURN e.open_question AS q, c.label AS concept
            ORDER BY e.created_at DESC LIMIT 2
        """, uid=user_id))

    # Build prompt context
    context_lines = []
    for r in contradictions:
        context_lines.append(f"- Unresolved contradiction: {r['c1']} vs {r['c2']} (tension: {round(r['score']*100)}%)")
    for r in drifting:
        context_lines.append(f"- Shifting concept: {r['label']} (stability: {round(r['stability']*100)}%)")
    for r in silent_concepts:
        context_lines.append(f"- Core concept not written about recently: {r['label']}")
    for r in open_questions:
        context_lines.append(f"- Open question: {r['q']} (related to {r['concept']})")

    if not context_lines:
        # Default prompts when graph has no data
        return [
            {"prompt": "What idea have you been avoiding thinking about?", "concept": None, "type": "open"},
            {"prompt": "What do you believe now that you would have rejected five years ago?", "concept": None, "type": "drift"},
        ]

    context = "\n".join(context_lines)

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=800,
        system="""You generate reflection prompts for a thought biography app. 
Given signals from the user's concept graph, write 4-5 sharp, honest prompts that invite genuine reflection.
Prompts should be specific to the data, not generic. They should feel like they come from someone who has read the person's work.
Return ONLY a JSON array with objects: {prompt, concept, type} where type is one of: contradiction, drift, silence, open.
No preamble, no markdown.""",
        messages=[{"role": "user", "content": f"Graph signals:\n{context}"}],
    )

    try:
        return json.loads(response.content[0].text)
    except Exception:
        return [{"prompt": "What are you currently most uncertain about?", "concept": None, "type": "open"}]


def build_digest(user_id: str) -> dict:
    """Build a weekly digest summary."""
    week_ago = (datetime.utcnow() - timedelta(days=7)).isoformat()
    with driver.session() as session:
        entries_week = session.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid})
            WHERE toString(e.created_at) > $week_ago
            RETURN count(e) AS n
        """, uid=user_id, week_ago=week_ago).single()["n"]

        total_entries = session.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid})
            RETURN count(e) AS n
        """, uid=user_id).single()["n"]

        new_concepts = session.run("""
            MATCH (c:Concept)-[:BELONGS_TO]->(:User {id: $uid})
            WHERE toString(c.first_seen) > $week_ago
            RETURN count(c) AS n
        """, uid=user_id, week_ago=week_ago).single()["n"]

        open_tensions = session.run("""
            MATCH (:Concept)-[r:CONTRADICTS]->(:Concept)
            WHERE r.user_id = $uid AND r.resolved = false
            RETURN count(r) AS n
        """, uid=user_id).single()["n"]

    summary = f"This week you wrote {entries_week} entr{'y' if entries_week == 1 else 'ies'}"
    if new_concepts:
        summary += f", introduced {new_concepts} new concept{'s' if new_concepts != 1 else ''}"
    summary += f", and have {open_tensions} open tension{'s' if open_tensions != 1 else ''} in your graph."

    return {
        "summary": summary,
        "stats": [
            {"value": entries_week,   "label": "entries this week"},
            {"value": new_concepts,   "label": "new concepts"},
            {"value": total_entries,  "label": "total entries"},
            {"value": open_tensions,  "label": "open tensions"},
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# SHARING
# ─────────────────────────────────────────────────────────────────────────────

class CreateShareRequest(BaseModel):
    email: EmailStr
    role: str = "reader"          # reader | reader_with_entries | annotator
    expires_in_days: int = 30


class AnnotationRequest(BaseModel):
    text: str


@router.get("/shares")
def list_shares(current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with driver.session() as session:
        result = session.run("""
            MATCH (u:User {id: $uid})-[:HAS_SHARE]->(s:ShareLink)
            WHERE s.expires_at > datetime()
            RETURN s ORDER BY s.created_at DESC
        """, uid=uid)
        shares = [dict(r["s"]) for r in result]
        for s in shares:
            for k in list(s):
                if hasattr(s[k], "isoformat"):
                    s[k] = s[k].isoformat()
    return {"shares": shares}


@router.post("/shares")
def create_share(req: CreateShareRequest, current_user: dict = Depends(get_current_user)):
    uid   = current_user["user_id"]
    token = str(uuid.uuid4())
    expires = datetime.utcnow() + timedelta(days=req.expires_in_days)
    link  = f"https://thoughtbiography.app/shared?share_token={token}"  # adjust domain

    with driver.session() as session:
        session.run("""
            MATCH (u:User {id: $uid})
            CREATE (s:ShareLink {
                id: $id, token: $token, email: $email,
                role: $role, expires_at: datetime($expires),
                created_at: datetime(), link: $link,
                owner_id: $uid, last_viewed: null
            })
            CREATE (u)-[:HAS_SHARE]->(s)
        """, uid=uid, id=str(uuid.uuid4()), token=token,
             email=req.email, role=req.role,
             expires=expires.isoformat(), link=link)

    share = {
        "id": token, "email": req.email, "role": req.role,
        "expires_at": expires.isoformat(), "link": link, "last_viewed": None,
    }

    # TODO: send email to req.email with the share link
    # send_share_email(req.email, link, current_user)

    return {"share": share, "link": link}


@router.delete("/shares/{share_id}")
def revoke_share(share_id: str, current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with driver.session() as session:
        session.run("""
            MATCH (u:User {id: $uid})-[:HAS_SHARE]->(s:ShareLink {token: $token})
            DETACH DELETE s
        """, uid=uid, token=share_id)
    return {"status": "revoked"}


@router.get("/shared/{share_token}")
def view_shared_graph(share_token: str):
    """Public endpoint — no auth required. Returns graph visible to token holder."""
    with driver.session() as session:
        share = session.run("""
            MATCH (s:ShareLink {token: $token})
            WHERE s.expires_at > datetime()
            MATCH (u:User {id: s.owner_id})
            SET s.last_viewed = datetime()
            RETURN s, u
        """, token=share_token).single()

        if not share:
            raise HTTPException(status_code=404, detail="Share link not found or expired")

        s = dict(share["s"])
        u = dict(share["u"])
        uid   = s["owner_id"]
        role  = s["role"]

        # Core concepts
        concepts_r = session.run("""
            MATCH (c:Concept)-[:BELONGS_TO]->(:User {id: $uid})
            WHERE c.is_core = true OR c.frequency >= 3
            RETURN c.label AS label, c.frequency AS frequency,
                   c.stability_score AS stability
            ORDER BY c.frequency DESC LIMIT 20
        """, uid=uid)
        core_concepts = [dict(r) for r in concepts_r]

        # Contradictions
        contra_r = session.run("""
            MATCH (c1:Concept)-[r:CONTRADICTS]->(c2:Concept)
            WHERE r.user_id = $uid AND r.resolved = false
            RETURN c1.label AS c1, c2.label AS c2, r.tension_score AS tension_score
            ORDER BY r.tension_score DESC LIMIT 5
        """, uid=uid)
        contradictions = [dict(r) for r in contra_r]

        # Annotations
        annotations_r = session.run("""
            MATCH (a:Annotation)-[:ON_SHARE]->(s:ShareLink {token: $token})
            RETURN a ORDER BY a.created_at
        """, token=share_token)
        annotations = [dict(r["a"]) for r in annotations_r]

        # Counts
        n_count = session.run("MATCH (c:Concept)-[:BELONGS_TO]->(:User {id: $uid}) RETURN count(c) AS n", uid=uid).single()["n"]
        e_count = session.run("MATCH ()-[r {user_id: $uid}]->() RETURN count(r) AS n", uid=uid).single()["n"]

    result = {
        "owner_name": u.get("display_name", "Anonymous"),
        "role": role,
        "expires_at": str(s.get("expires_at", "")),
        "core_concepts": core_concepts,
        "contradictions": contradictions,
        "annotations": annotations,
        "node_count": n_count,
        "edge_count": e_count,
    }

    if role in ("reader_with_entries", "annotator"):
        # Add recent entry excerpts (NOT full content)
        entries_r = session.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid})
            RETURN substring(e.content, 0, 200) AS excerpt, e.created_at AS date,
                   e.emotional_tone AS tone
            ORDER BY e.created_at DESC LIMIT 10
        """, uid=uid)
        result["recent_excerpts"] = [dict(r) for r in entries_r]

    return result


@router.post("/shared/{share_token}/annotate")
def add_annotation(share_token: str, req: AnnotationRequest):
    with driver.session() as session:
        share = session.run("""
            MATCH (s:ShareLink {token: $token})
            WHERE s.role IN ['annotator'] AND s.expires_at > datetime()
            RETURN s
        """, token=share_token).single()

        if not share:
            raise HTTPException(status_code=403, detail="Annotation not allowed for this share")

        session.run("""
            MATCH (s:ShareLink {token: $token})
            CREATE (a:Annotation {
                id: $id, text: $text, created_at: datetime()
            })-[:ON_SHARE]->(s)
        """, token=share_token, id=str(uuid.uuid4()), text=req.text)

    return {"status": "added"}


def register_reminders_sharing_routes(app):
    app.include_router(router)

