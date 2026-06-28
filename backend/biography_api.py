"""
biography_api.py — Biography generation endpoints
---------------------------------------------------
Add these routes to api.py, or run standalone.

Endpoints:
    GET  /biography/data      — Assemble all graph data needed for generation
    POST /biography/generate  — Start generation, returns SSE stream
    GET  /biography/latest    — Retrieve last generated biography
    POST /biography/export    — Export as markdown file
"""
from neo4j import GraphDatabase
import os
import json
import asyncio
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

NEO4J_URI      = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER     = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")

driver = GraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASSWORD)
)

def db(cypher, params=None):
    with driver.session() as s:
        return [r.data() for r in s.run(cypher, params or {})]


# ── Assemble all graph data for biography generation ─────────────────────────

def assemble_biography_data() -> dict:
    """
    Pulls everything needed from Neo4j in one call and shapes it
    for the biography_generator prompts.
    """

    # Nodes
    nodes = db("""
        MATCH (n)
        RETURN
            CASE WHEN n:Concept THEN n.label WHEN n:Person THEN n.name
                 WHEN n:Source THEN n.title WHEN n:LifeContext THEN n.label END AS id,
            CASE WHEN n:Concept THEN 'concept' WHEN n:Person THEN 'person'
                 WHEN n:Source THEN 'source' WHEN n:LifeContext THEN 'era' END AS type,
            COALESCE(n.frequency, 1) AS frequency,
            COALESCE(n.stability_score, 1.0) AS stability,
            COALESCE(n.is_core, false) AS core
    """)

    # Edges
    edges = db("""
        MATCH (a)-[r]->(b)
        WHERE type(r) IN ['REINFORCES','CONTRADICTS','EVOLVED_INTO','INTRODUCED','CATALYZED','CONTEXT']
        RETURN
            CASE WHEN a:Concept THEN a.label WHEN a:Person THEN a.name
                 WHEN a:Source THEN a.title WHEN a:LifeContext THEN a.label END AS source,
            CASE WHEN b:Concept THEN b.label WHEN b:Person THEN b.name
                 WHEN b:Source THEN b.title WHEN b:LifeContext THEN b.label END AS target,
            type(r) AS type,
            COALESCE(r.strength, r.weight, 0.5) AS strength
        LIMIT 500
    """)

    # Recent entries with summaries
    entries = db("""
        MATCH (e:Entry)
        OPTIONAL MATCH (e)-[:OCCURRED_DURING]->(lc:LifeContext)
        RETURN e.summary AS summary, e.created_at AS created_at,
               e.open_question AS open_question,
               e.emotional_tone AS tone,
               lc.label AS life_context
        ORDER BY e.created_at DESC
        LIMIT 100
    """)

    # Contradictions with snippets
    contradictions = db("""
        MATCH (c1:Concept)-[r:CONTRADICTS]->(c2:Concept)
        OPTIONAL MATCH (e1:Entry)-[s1:SURFACES]->(c1)
        OPTIONAL MATCH (e2:Entry)-[s2:SURFACES]->(c2)
        RETURN c1.label AS concept_a, c2.label AS concept_b,
               r.tension_score AS tension_score,
               COALESCE(r.resolved, false) AS resolved,
               r.resolution_note AS resolution_note,
               collect(DISTINCT {date: e1.created_at, text: e1.summary, concept: c1.label})[0..3] AS snippets_a,
               collect(DISTINCT {date: e2.created_at, text: e2.summary, concept: c2.label})[0..3] AS snippets_b
        ORDER BY r.tension_score DESC
        LIMIT 6
    """)

    # Format contradictions with combined snippets
    formatted_contradictions = []
    for c in contradictions:
        snippets = []
        for s in (c.get("snippets_a") or []):
            if s and s.get("text"):
                snippets.append(s)
        for s in (c.get("snippets_b") or []):
            if s and s.get("text"):
                snippets.append(s)
        formatted_contradictions.append({
            **c,
            "entry_snippets": snippets[:4],
        })

    # People with influenced concepts
    people = db("""
        MATCH (p:Person)-[:INTRODUCED]->(c:Concept)
        RETURN p.name AS name, p.first_mentioned AS first_mentioned,
               collect(c.label) AS concepts
        ORDER BY size(collect(c.label)) DESC
        LIMIT 10
    """)

    # Sources with catalyzed concepts
    sources = db("""
        MATCH (s:Source)-[:CATALYZED]->(c:Concept)
        RETURN s.title AS title, s.consumed_at AS consumed_at,
               collect(c.label) AS concepts
        ORDER BY size(collect(c.label)) DESC
        LIMIT 10
    """)

    # Concept drift histories for core concepts
    core_labels = [n["id"] for n in nodes if n.get("core") and n.get("type") == "concept"]
    concept_histories = {}

    for label in core_labels[:6]:
        snaps = db("""
            MATCH (e:Entry)-[r:SURFACES]->(c:Concept {label: $label})
            OPTIONAL MATCH (e)-[:OCCURRED_DURING]->(lc:LifeContext)
            WHERE r.is_new_definition = true OR e.significance_score > 0.75
            RETURN e.created_at AS date, COALESCE(lc.label, 'Unknown') AS era,
                   COALESCE(r.definition_note, r.context_snippet, e.summary) AS definition,
                   r.weight AS weight
            ORDER BY e.created_at ASC
            LIMIT 8
        """, {"label": label})

        if snaps:
            concept_histories[label] = {
                "snapshots": [
                    {
                        "date": str(s.get("date") or "")[:10],
                        "era": s.get("era", "Unknown"),
                        "definition": s.get("definition") or "—",
                        "weight": s.get("weight") or 0.5,
                        "stability": 0.7,
                    }
                    for s in snaps
                ],
                "color": "#C4A882",
            }

    # Stats
    stats_rows = db("MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count")
    stats = {r["label"]: r["count"] for r in stats_rows if r["label"]}

    return {
        "nodes": [n for n in nodes if n["id"]],
        "edges": [e for e in edges if e["source"] and e["target"]],
        "entries": entries,
        "contradictions": formatted_contradictions,
        "people": people,
        "sources": sources,
        "concept_histories": concept_histories,
        "stats": {
            "entries": stats.get("Entry", 0),
            "concepts": stats.get("Concept", 0),
        },
    }


# ── SSE streaming endpoint ────────────────────────────────────────────────────

async def biography_sse_stream(graph_data: dict):
    """
    Server-Sent Events generator for the biography stream.
    Each event: data: {"section": "...", "text": "...", "status": "..."}
    """
    from biography_generator import generate_biography

    async for chunk in generate_biography(graph_data):
        yield f"data: {json.dumps(chunk)}\n\n"
        await asyncio.sleep(0)  # yield control to event loop

    yield "data: [DONE]\n\n"


# ── Route handlers (add to your FastAPI app) ──────────────────────────────────
# These are written as standalone functions — paste them into api.py
# and register with: app.include_router(biography_router)
# or add directly: app.add_api_route("/biography/...", handler)

async def get_biography_data():
    """GET /biography/data — Returns assembled graph data for generation."""
    try:
        data = assemble_biography_data()
        return JSONResponse(data)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def generate_biography_stream():
    """
    GET /biography/generate — SSE stream of biography generation.
    Connect with EventSource in the frontend.
    """
    try:
        graph_data = assemble_biography_data()
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


async def export_biography_markdown(body: dict):
    """
    POST /biography/export — Export biography as downloadable markdown.
    body: { "sections": {...}, "full_text": "..." }
    """
    full_text = body.get("full_text", "")
    timestamp = datetime.now().strftime("%Y-%m-%d")
    filename = f"thought-biography-{timestamp}.md"

    header = f"""# Thought Biography
*Generated {datetime.now().strftime("%B %d, %Y")}*

---

"""
    content = header + full_text

    from fastapi.responses import Response
    return Response(
        content=content.encode("utf-8"),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Registration helper ───────────────────────────────────────────────────────
def get_biography_latest(current_user: dict = Depends(get_current_user)):
    """GET /biography — get latest saved biography."""
    uid = current_user["user_id"]
    with driver.session() as s:
        r = s.run("""
            MATCH (u:User {id:$uid})
            RETURN u.biography_text AS text, u.biography_updated AS updated
        """, uid=uid).single()
        if r and r["text"]:
            return {"text": r["text"], "updated": str(r["updated"] or "")}
        return {"text": None, "updated": None}


def get_biography_history(current_user: dict = Depends(get_current_user)):
    """GET /biography/history — list saved biography versions."""
    uid = current_user["user_id"]
    with driver.session() as s:
        rows = s.run("""
            MATCH (u:User {id:$uid})
            RETURN u.biography_text AS text, u.biography_updated AS updated
        """, uid=uid).data()
        return {"history": [{"text": r["text"], "updated": str(r["updated"] or "")} for r in rows if r.get("text")]}


def save_biography(body: dict, current_user: dict = Depends(get_current_user)):
    """POST /biography/save — save generated biography text."""
    uid = current_user["user_id"]
    text = body.get("text", "")
    with driver.session() as s:
        s.run("""
            MATCH (u:User {id:$uid})
            SET u.biography_text = $text, u.biography_updated = datetime()
        """, uid=uid, text=text)
    return {"status": "saved"}


def register_biography_routes(app):
    """
    Call this in api.py:

        from biography_api import register_biography_routes
        register_biography_routes(app)
    """
    from pydantic import BaseModel

    class ExportBody(BaseModel):
        full_text: str
        sections: dict = {}

    app.add_api_route("/biography/data",     get_biography_data,          methods=["GET"])
    app.add_api_route("/biography/generate", generate_biography_stream,   methods=["GET"])
    app.add_api_route("/biography/export",   export_biography_markdown,   methods=["POST"])
    app.add_api_route("/biography",          get_biography_latest,        methods=["GET"])
    app.add_api_route("/biography/history",  get_biography_history,       methods=["GET"])
    app.add_api_route("/biography/save",     save_biography,              methods=["POST"])
    app.add_api_route("/biography/stream",   generate_biography_stream,   methods=["GET"])

    print("✓ Biography routes registered")

