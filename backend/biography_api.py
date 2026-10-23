"""
biography_api.py — Biography generation endpoints
"""
from neo4j import GraphDatabase
import os
import json
import re
import asyncio
import logging
from datetime import datetime, timezone

logging.getLogger("neo4j.notifications").setLevel(logging.ERROR)
from fastapi import FastAPI, Depends
from auth import get_current_user, require_subscription
from fastapi.responses import StreamingResponse, JSONResponse, Response
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI      = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER     = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

_posthog_key = os.getenv("POSTHOG_API_KEY")
if _posthog_key:
    import posthog as _posthog
    _posthog.api_key = _posthog_key
    _posthog.host = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com")
else:
    _posthog = None


def serialize_dt(val):
    if val is None:
        return None
    s = str(val)
    s = re.sub(r'(\.\d{3})\d+([\+\-Z])', r'\1\2', s)
    s = re.sub(r'(\.\d{3})\d+$', r'\1', s)
    return s


def db(cypher, params=None):
    with driver.session() as s:
        return [r.data() for r in s.run(cypher, params or {})]


def assemble_biography_data(user_id: str) -> dict:
    """
    Pull all graph data for this user from Neo4j.
    Always scoped by user_id.
    """
    # Nodes
    nodes = db("""
        MATCH (n:Concept {user_id: $uid})
        RETURN
            n.label AS id,
            'concept' AS type,
            coalesce(n.frequency, 1) AS frequency,
            coalesce(n.stability_score, 1.0) AS stability,
            coalesce(n.is_core, false) AS core
        UNION ALL
        MATCH (n:Person {user_id: $uid})
        RETURN n.name AS id, 'person' AS type, 1 AS frequency, 1.0 AS stability, false AS core
        UNION ALL
        MATCH (n:Source {user_id: $uid})
        RETURN n.title AS id, 'source' AS type, 1 AS frequency, 1.0 AS stability, false AS core
        UNION ALL
        MATCH (n:LifeContext {user_id: $uid})
        RETURN n.label AS id, 'era' AS type, 1 AS frequency, 1.0 AS stability, false AS core
    """, {"uid": user_id})

    # Edges
    edges = db("""
        MATCH (a:Concept {user_id: $uid})-[r:REINFORCES|CONTRADICTS|EVOLVED_INTO]->(b:Concept {user_id: $uid})
        WHERE a.label <> b.label
        RETURN
            a.label AS source,
            b.label AS target,
            type(r) AS type,
            coalesce(r.strength, r.tension_score, r.weight, 0.5) AS strength
        LIMIT 200
    """, {"uid": user_id})

    # Entries — include actual content for the generator
    entries = db("""
        MATCH (e:Entry {user_id: $uid})
        OPTIONAL MATCH (e)-[:OCCURRED_DURING]->(lc:LifeContext)
        RETURN
            e.content AS content,
            e.summary AS summary,
            toString(e.created_at) AS created_at,
            e.open_question AS open_question,
            e.emotional_tone AS emotional_tone,
            lc.label AS life_context
        ORDER BY e.created_at ASC
    """, {"uid": user_id})

    # Clean up dates
    for e in entries:
        e["created_at"] = serialize_dt(e.get("created_at"))

    # Contradictions with actual entry content
    contradictions = db("""
        MATCH (c1:Concept {user_id: $uid})-[r:CONTRADICTS]->(c2:Concept {user_id: $uid})
        WHERE c1.label <> c2.label AND NOT coalesce(r.resolved, false)
        OPTIONAL MATCH (e1:Entry {user_id: $uid})-[:SURFACES]->(c1)
        OPTIONAL MATCH (e2:Entry {user_id: $uid})-[:SURFACES]->(c2)
        RETURN
            c1.label AS concept_a,
            c2.label AS concept_b,
            coalesce(r.tension_score, 0.5) AS tension_score,
            coalesce(r.resolved, false) AS resolved,
            r.resolution_note AS resolution_note,
            collect(DISTINCT {
                date: toString(e1.created_at),
                content: substring(e1.content, 0, 300),
                summary: e1.summary,
                concept: c1.label
            })[0..3] AS snippets_a,
            collect(DISTINCT {
                date: toString(e2.created_at),
                content: substring(e2.content, 0, 300),
                summary: e2.summary,
                concept: c2.label
            })[0..3] AS snippets_b
        ORDER BY r.tension_score DESC
        LIMIT 6
    """, {"uid": user_id})

    formatted_contradictions = []
    for c in contradictions:
        snippets = []
        for s in (c.get("snippets_a") or []):
            if s and (s.get("content") or s.get("summary")):
                snippets.append({
                    "date": serialize_dt(s.get("date")),
                    "content": s.get("content") or s.get("summary"),
                    "concept": s.get("concept"),
                })
        for s in (c.get("snippets_b") or []):
            if s and (s.get("content") or s.get("summary")):
                snippets.append({
                    "date": serialize_dt(s.get("date")),
                    "content": s.get("content") or s.get("summary"),
                    "concept": s.get("concept"),
                })
        formatted_contradictions.append({**c, "entry_snippets": snippets[:4]})

    # People
    people = db("""
        MATCH (p:Person {user_id: $uid})-[:INTRODUCED]->(c:Concept {user_id: $uid})
        RETURN
            p.name AS name,
            toString(p.first_mentioned) AS first_mentioned,
            collect(c.label) AS concepts
        ORDER BY size(collect(c.label)) DESC
        LIMIT 10
    """, {"uid": user_id})

    # Sources
    sources = db("""
        MATCH (s:Source {user_id: $uid})-[:CATALYZED]->(c:Concept {user_id: $uid})
        RETURN
            s.title AS title,
            toString(s.consumed_at) AS consumed_at,
            collect(c.label) AS concepts
        ORDER BY size(collect(c.label)) DESC
        LIMIT 10
    """, {"uid": user_id})

    # Concept histories for core concepts
    core_labels = [n["id"] for n in nodes if n.get("core") and n.get("type") == "concept"]
    concept_histories = {}
    for label in core_labels[:6]:
        snaps = db("""
            MATCH (e:Entry {user_id: $uid})-[r:SURFACES]->(c:Concept {label: $label, user_id: $uid})
            OPTIONAL MATCH (e)-[:OCCURRED_DURING]->(lc:LifeContext)
            WHERE r.is_new_definition = true OR e.significance_score > 0.75
            RETURN
                toString(e.created_at) AS date,
                coalesce(lc.label, 'Unknown') AS era,
                coalesce(r.definition_note, r.context_snippet, e.summary, substring(e.content, 0, 200)) AS definition,
                r.weight AS weight
            ORDER BY e.created_at ASC
            LIMIT 8
        """, {"label": label, "uid": user_id})

        if snaps:
            concept_histories[label] = {
                "snapshots": [
                    {
                        "date": serialize_dt(s.get("date")),
                        "era": s.get("era", "Unknown"),
                        "definition": s.get("definition") or "—",
                        "weight": s.get("weight") or 0.5,
                    }
                    for s in snaps
                ]
            }

    stats_rows = db("""
        MATCH (e:Entry {user_id: $uid}) RETURN count(e) AS entries
        UNION ALL
        MATCH (c:Concept {user_id: $uid}) RETURN count(c) AS entries
    """, {"uid": user_id})

    return {
        "nodes": [n for n in nodes if n.get("id")],
        "edges": [e for e in edges if e.get("source") and e.get("target")],
        "entries": entries,
        "contradictions": formatted_contradictions,
        "people": people,
        "sources": sources,
        "concept_histories": concept_histories,
        "stats": {
            "entries": len(entries),
            "concepts": len([n for n in nodes if n.get("type") == "concept"]),
        },
    }


async def biography_sse_stream(graph_data: dict):
    from biography_generator import generate_biography
    async for chunk in generate_biography(graph_data):
        yield f"data: {json.dumps(chunk)}\n\n"
        await asyncio.sleep(0)
    yield "data: [DONE]\n\n"


async def get_biography_latest(current_user: dict = Depends(get_current_user)):
    """GET /biography — readiness check + latest saved biography."""
    uid = current_user["user_id"]
    with driver.session() as s:
        r = s.run("""
            MATCH (u:User {id: $uid})
            OPTIONAL MATCH (e:Entry {user_id: $uid})
            WITH u, count(e) AS entry_count
            RETURN u.biography_text AS text, u.biography_updated AS updated, entry_count
        """, uid=uid).single()

        if r:
            entry_count = r["entry_count"] or 0
            min_required = 5
            return {
                "text": r["text"],
                "updated": serialize_dt(r["updated"]),
                "ready": entry_count >= min_required,
                "entry_count": entry_count,
                "min_required": min_required,
                "entries_needed": max(0, min_required - entry_count),
            }
    return {"text": None, "updated": None, "ready": False, "entry_count": 0, "min_required": 5, "entries_needed": 5}


async def generate_biography_stream(current_user: dict = Depends(get_current_user)):
    """GET /biography/generate — SSE stream of biography generation."""
    uid = current_user["user_id"]
    try:
        graph_data = assemble_biography_data(uid)
        return StreamingResponse(
            biography_sse_stream(graph_data),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            }
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def export_biography(body: dict, current_user: dict = Depends(require_subscription)):
    """
    POST /biography/export
    body: { "full_text": "...", "format": "pdf" | "docx" | "md" }
    """
    from biography_export import export_pdf, export_docx

    full_text = body.get("full_text", "")
    fmt = body.get("format", "md").lower()
    timestamp = datetime.now().strftime("%Y-%m-%d")
    display_name = current_user.get("display_name") or "The Thinker"

    header = f"# Thought Biography\n*{display_name} · {datetime.now().strftime('%B %Y')}*\n\n---\n\n"
    full_content = header + full_text

    if fmt == "pdf":
        try:
            pdf_bytes = export_pdf(full_content, display_name, timestamp)
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="thought-biography-{timestamp}.pdf"'},
            )
        except Exception as e:
            return JSONResponse({"error": f"PDF export failed: {str(e)}"}, status_code=500)

    if fmt == "docx":
        try:
            docx_bytes = export_docx(full_content, display_name, timestamp)
            return Response(
                content=docx_bytes,
                media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                headers={"Content-Disposition": f'attachment; filename="thought-biography-{timestamp}.docx"'},
            )
        except Exception as e:
            return JSONResponse({"error": f"DOCX export failed: {str(e)}"}, status_code=500)

    # Default: markdown
    return Response(
        content=full_content.encode("utf-8"),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="thought-biography-{timestamp}.md"'},
    )


def get_biography_history(current_user: dict = Depends(get_current_user)):
    """GET /biography/history"""
    uid = current_user["user_id"]
    with driver.session() as s:
        rows = s.run("""
            MATCH (bv:BiographyVersion {user_id: $uid})
            RETURN
                bv.id AS id,
                bv.text AS text,
                toString(bv.generated_at) AS generated_at,
                bv.style AS style,
                bv.period_start AS period_start,
                bv.period_end AS period_end
            ORDER BY bv.generated_at DESC
            LIMIT 20
        """, uid=uid).data()

        # Fallback: if no BiographyVersion nodes, return the single saved text
        if not rows:
            r = s.run("""
                MATCH (u:User {id: $uid})
                RETURN u.biography_text AS text, toString(u.biography_updated) AS generated_at
            """, uid=uid).single()
            if r and r["text"]:
                rows = [{"id": "latest", "text": r["text"], "generated_at": serialize_dt(r["generated_at"]), "style": "literary"}]

    return {"biographies": [{**r, "generated_at": serialize_dt(r.get("generated_at"))} for r in rows]}


async def save_biography(body: dict, current_user: dict = Depends(get_current_user)):
    """POST /biography/save"""
    uid = current_user["user_id"]
    text = body.get("full_text") or body.get("text") or body.get("stream_text") or ""
    style = body.get("style", "literary")

    if not text.strip():
        return {"status": "nothing to save"}

    bio_id = __import__("uuid").uuid4().hex

    with driver.session() as s:
        # Save as versioned node
        s.run("""
            CREATE (bv:BiographyVersion {
                id: $bid,
                user_id: $uid,
                text: $text,
                style: $style,
                generated_at: datetime()
            })
        """, bid=bio_id, uid=uid, text=text, style=style)

        # Also update the latest shortcut on User
        s.run("""
            MATCH (u:User {id: $uid})
            SET u.biography_text = $text,
                u.biography_updated = datetime()
        """, uid=uid, text=text)

    if _posthog:
        try:
            _posthog.capture(uid, "biography_saved", {"length_chars": len(text)})
        except Exception:
            pass

    return {"status": "saved", "id": bio_id}


def register_biography_routes(app):
    from pydantic import BaseModel

    class ExportBody(BaseModel):
        full_text: str
        format: str = "md"

    class SaveBody(BaseModel):
        full_text: str = ""
        text: str = ""
        stream_text: str = ""
        style: str = "literary"

    app.add_api_route("/biography",          get_biography_latest,        methods=["GET"])
    app.add_api_route("/biography/generate", generate_biography_stream,   methods=["GET"])
    app.add_api_route("/biography/stream",   generate_biography_stream,   methods=["GET"])
    app.add_api_route("/biography/export",   export_biography,            methods=["POST"])
    app.add_api_route("/biography/history",  get_biography_history,       methods=["GET"])
    app.add_api_route("/biography/save",     save_biography,              methods=["POST"])

    print("✓ Biography routes registered")

