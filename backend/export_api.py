"""
export_api.py — Data export endpoints for Thought Biography
Generates JSON, Markdown, and graph topology exports from Neo4j.
"""
from neo4j import GraphDatabase
from fastapi import APIRouter, Query, Depends
from fastapi.responses import Response
from neo4j import GraphDatabase
from auth import get_current_user
from datetime import datetime
import os, json
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(tags=["export"])

NEO4J_URI  = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "yourpassword")
driver     = GraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASSWORD)
)


def neo4j_val(v):
    """Convert Neo4j temporal types to strings."""
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: neo4j_val(val) for k, val in v.items()}
    if isinstance(v, list):
        return [neo4j_val(i) for i in v]
    return v


# ── Export builders ───────────────────────────────────────────────────────────
def build_json_export(user_id: str) -> dict:
    with driver.session() as session:
        # Entries
        entries_r = session.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid})
            OPTIONAL MATCH (e)-[:SURFACES]->(c:Concept)
            WITH e, collect(c.label) AS concepts
            RETURN e, concepts ORDER BY e.created_at
        """, uid=user_id)
        entries = []
        for r in entries_r:
            e = {k: neo4j_val(v) for k, v in dict(r["e"]).items()}
            e["concepts"] = r["concepts"]
            entries.append(e)

        # Concepts with drift history
        concepts_r = session.run("""
            MATCH (c:Concept)-[:BELONGS_TO]->(:User {id: $uid})
            RETURN c ORDER BY c.first_seen
        """, uid=user_id)
        concepts = [{k: neo4j_val(v) for k, v in dict(r["c"]).items()} for r in concepts_r]

        # Relationships
        rels_r = session.run("""
            MATCH (a)-[r]->(b)
            WHERE r.user_id = $uid
            RETURN type(r) AS type,
                   a.id    AS from_id,
                   a.label AS from_label,
                   b.id    AS to_id,
                   b.label AS to_label,
                   properties(r) AS props
        """, uid=user_id)
        relationships = []
        for r in rels_r:
            relationships.append({
                "type": r["type"],
                "from": {"id": r["from_id"], "label": r["from_label"]},
                "to":   {"id": r["to_id"],   "label": r["to_label"]},
                "properties": {k: neo4j_val(v) for k, v in dict(r["props"]).items()},
            })

        # People and sources
        influences_r = session.run("""
            MATCH (p)-[:INTRODUCED|CATALYZED]->(:Concept)
            WHERE p.user_id = $uid
            RETURN DISTINCT p ORDER BY p.first_mentioned
        """, uid=user_id)
        influences = [{k: neo4j_val(v) for k, v in dict(r["p"]).items()} for r in influences_r]

    return {
        "export_version": "1.0",
        "exported_at": datetime.utcnow().isoformat(),
        "user_id": user_id,
        "entries": entries,
        "concepts": concepts,
        "relationships": relationships,
        "influences": influences,
    }


def build_markdown_export(user_id: str) -> str:
    with driver.session() as session:
        entries_r = session.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid})
            OPTIONAL MATCH (e)-[:SURFACES]->(c:Concept)
            WITH e, collect(c.label) AS concepts
            RETURN e, concepts ORDER BY e.created_at
        """, uid=user_id)
        entries = []
        for r in entries_r:
            e = dict(r["e"])
            entries.append({
                "date":         neo4j_val(e.get("created_at", "")),
                "tone":         e.get("emotional_tone", ""),
                "content":      e.get("content", ""),
                "concepts":     r["concepts"],
                "significance": e.get("significance_score", 0),
                "open_question": e.get("open_question", ""),
            })

    lines = [
        "# Thought Biography",
        f"*Exported {datetime.utcnow().strftime('%B %d, %Y')}*",
        f"*{len(entries)} entries*",
        "",
        "---",
        "",
    ]

    for e in entries:
        date_str = e["date"]
        try:
            dt = datetime.fromisoformat(date_str.split(".")[0])
            date_str = dt.strftime("%B %d, %Y")
        except Exception:
            pass

        lines.append(f"## {date_str}")
        meta = []
        if e["tone"]:       meta.append(f"**Tone:** {e['tone']}")
        if e["concepts"]:   meta.append(f"**Concepts:** {', '.join(e['concepts'])}")
        if e["significance"]: meta.append(f"**Significance:** {round(e['significance'], 2)}")
        if meta:
            lines.append(" | ".join(meta))
        lines.append("")
        lines.append(e["content"] or "")
        if e.get("open_question"):
            lines.append("")
            lines.append(f"> *Open question: {e['open_question']}*")
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def build_graph_export(user_id: str) -> dict:
    """Nodes and edges only — no entry content. Compatible with Gephi / Cytoscape."""
    with driver.session() as session:
        nodes_r = session.run("""
            MATCH (c:Concept)-[:BELONGS_TO]->(:User {id: $uid})
            RETURN c.id AS id, c.label AS label, 'Concept' AS type,
                   c.frequency AS frequency, c.stability_score AS stability,
                   c.is_core AS is_core
        """, uid=user_id)
        nodes = [dict(r) for r in nodes_r]

        edges_r = session.run("""
            MATCH (a:Concept)-[r]->(b:Concept)
            WHERE r.user_id = $uid
            RETURN a.id AS source, b.id AS target,
                   type(r) AS relationship,
                   coalesce(r.strength, r.tension_score, r.shift_magnitude, 1.0) AS weight
        """, uid=user_id)
        edges = [dict(r) for r in edges_r]

    return {
        "format": "graph-json-1.0",
        "exported_at": datetime.utcnow().isoformat(),
        "nodes": nodes,
        "edges": edges,
        "node_count": len(nodes),
        "edge_count": len(edges),
    }


# ── Routes ────────────────────────────────────────────────────────────────────
@router.get("/export")
def export(
    format: str = Query("json", regex="^(json|markdown|graph)$"),
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]

    if format == "json":
        content = build_json_export(uid)
        size_hint = f"~{len(json.dumps(content)) // 1024} KB"
        return {"format": format, "content": content, "size_hint": size_hint}

    elif format == "markdown":
        content = build_markdown_export(uid)
        size_hint = f"~{len(content) // 1024} KB"
        return {"format": format, "content": content, "size_hint": size_hint}

    elif format == "graph":
        content = build_graph_export(uid)
        size_hint = f"{content['node_count']} nodes, {content['edge_count']} edges"
        return {"format": format, "content": content, "size_hint": size_hint}


def register_export_routes(app):
    app.include_router(router)

