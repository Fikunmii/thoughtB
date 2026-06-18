"""
search_api.py — Full-text and semantic search for Thought Biography
Registers /search endpoint on the FastAPI app.
"""
from neo4j import GraphDatabase
from fastapi import APIRouter, Query, Depends
from neo4j import GraphDatabase
import anthropic
import os
import json
from auth import get_current_user
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(tags=["search"])

NEO4J_URI  = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "yourpassword")
driver     = GraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASSWORD)
)

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


# ── Full-text search ──────────────────────────────────────────────────────────
def fulltext_search(user_id: str, query: str, limit: int = 20) -> list[dict]:
    with driver.session() as session:
        result = session.run("""
            CALL db.index.fulltext.queryNodes('entry_content', $query)
            YIELD node, score
            WHERE (node)-[:BELONGS_TO]->(:User {id: $user_id})
            MATCH (node)-[:SURFACES]->(c:Concept)
            WITH node, score, collect(c.label)[0..5] AS concepts
            RETURN
                node.id          AS id,
                node.created_at  AS created_at,
                node.emotional_tone AS emotional_tone,
                substring(node.content, 0, 300) AS excerpt,
                concepts,
                score
            ORDER BY score DESC
            LIMIT $limit
        """, query=query, user_id=user_id, limit=limit)
        return [dict(r) for r in result]


# ── Concept search ────────────────────────────────────────────────────────────
def concept_search(user_id: str, query: str, limit: int = 20) -> list[dict]:
    with driver.session() as session:
        result = session.run("""
            MATCH (c:Concept)
            WHERE toLower(c.label) CONTAINS toLower($query)
            MATCH (e:Entry)-[:SURFACES]->(c)
            WHERE (e)-[:BELONGS_TO]->(:User {id: $user_id})
            MATCH (e)-[:SURFACES]->(allC:Concept)
            WITH e, collect(DISTINCT allC.label)[0..5] AS concepts
            RETURN
                e.id           AS id,
                e.created_at   AS created_at,
                e.emotional_tone AS emotional_tone,
                substring(e.content, 0, 300) AS excerpt,
                concepts
            ORDER BY e.created_at DESC
            LIMIT $limit
        """, query=query, user_id=user_id, limit=limit)
        return [dict(r) for r in result]


# ── Semantic search via Claude embeddings ─────────────────────────────────────
def semantic_search(user_id: str, query: str, limit: int = 20) -> list[dict]:
    """
    True semantic search requires a vector database (Pinecone / Weaviate).
    This implementation uses Claude to identify relevant concepts, then
    queries the graph for entries containing those concepts.
    Production path: store entry embeddings in Pinecone, use cosine similarity.
    """
    # Step 1: Ask Claude to expand the query into related concepts
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=200,
        system="Extract 3-5 philosophical concepts or themes from the user's search query. Return ONLY a JSON array of strings. No explanation.",
        messages=[{"role": "user", "content": f"Search query: {query}"}],
    )

    try:
        expanded = json.loads(response.content[0].text)
    except Exception:
        expanded = [query]

    # Step 2: Find entries containing any of the expanded concepts
    with driver.session() as session:
        results = []
        seen = set()
        for concept in expanded:
            r = session.run("""
                MATCH (c:Concept)
                WHERE toLower(c.label) CONTAINS toLower($concept)
                MATCH (e:Entry)-[s:SURFACES]->(c)
                WHERE (e)-[:BELONGS_TO]->(:User {id: $user_id})
                  AND NOT e.id IN $seen
                MATCH (e)-[:SURFACES]->(allC:Concept)
                WITH e, s, collect(DISTINCT allC.label)[0..5] AS concepts
                RETURN
                    e.id           AS id,
                    e.created_at   AS created_at,
                    e.emotional_tone AS emotional_tone,
                    substring(e.content, 0, 300) AS excerpt,
                    concepts,
                    s.weight       AS similarity_score
                ORDER BY s.weight DESC
                LIMIT 10
            """, concept=concept, user_id=user_id, seen=list(seen))

            for record in r:
                d = dict(record)
                if d["id"] not in seen:
                    seen.add(d["id"])
                    results.append(d)

        return sorted(results, key=lambda x: -(x.get("similarity_score") or 0))[:limit]


# ── Dashboard data ────────────────────────────────────────────────────────────
def get_dashboard_data(user_id: str) -> dict:
    with driver.session() as session:
        # Stats
        stats = {}
        for label, cypher in [
            ("entries",       "MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid}) RETURN count(e) AS n"),
            ("concepts",      "MATCH (c:Concept)-[:BELONGS_TO]->(:User {id: $uid}) RETURN count(c) AS n"),
            ("contradictions","MATCH (:Concept)-[r:CONTRADICTS]-(:Concept) WHERE r.user_id = $uid RETURN count(r) AS n"),
            ("resolved",      "MATCH (:Concept)-[r:CONTRADICTS]-(:Concept) WHERE r.user_id = $uid AND r.resolved = true RETURN count(r) AS n"),
            ("influences",    "MATCH (p)-[:INTRODUCED|CATALYZED]->(:Concept) WHERE p.user_id = $uid RETURN count(DISTINCT p) AS n"),
        ]:
            res = session.run(cypher, uid=user_id)
            stats[label] = (res.single() or {}).get("n", 0)

        # Latest entry
        le = session.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid})
            OPTIONAL MATCH (e)-[:SURFACES]->(c:Concept)
            WITH e, collect(c.label)[0..5] AS concepts
            RETURN e, concepts ORDER BY e.created_at DESC LIMIT 1
        """, uid=user_id).single()

        latest = None
        if le:
            e = dict(le["e"])
            latest = {
                "created_at":    str(e.get("created_at", "")),
                "emotional_tone": e.get("emotional_tone", ""),
                "excerpt":        e.get("content", "")[:280],
                "concepts":       le["concepts"],
            }

        # Open questions
        oq = session.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid})
            WHERE e.open_question IS NOT NULL
            OPTIONAL MATCH (e)-[:SURFACES]->(c:Concept)
            RETURN e.open_question AS question, toString(e.created_at) AS entry_date,
                   collect(c.label)[0] AS concept
            ORDER BY e.created_at DESC LIMIT 20
        """, uid=user_id)
        seen_questions = set()
        open_questions = []
        for r in oq:
            row = dict(r)
            if row["question"] in seen_questions:
                continue
            seen_questions.add(row["question"])
            open_questions.append(row)
            if len(open_questions) == 5:
                break

        # Contradictions
        contra = session.run("""
            MATCH (c1:Concept)-[r:CONTRADICTS]->(c2:Concept)
            WHERE r.user_id = $uid AND r.resolved = false
            RETURN c1.label AS c1, c2.label AS c2, r.tension_score AS tension_score
            ORDER BY r.tension_score DESC LIMIT 5
        """, uid=user_id)
        contradictions = [dict(r) for r in contra]

        # Shifting concepts
        shifting = session.run("""
            MATCH (c:Concept)-[:BELONGS_TO]->(:User {id: $uid})
            WHERE c.stability_score < 0.75
            RETURN c.label AS label, c.stability_score AS stability
            ORDER BY c.stability_score ASC LIMIT 8
        """, uid=user_id)
        shifting_concepts = [dict(r) for r in shifting]

        # Days since last entry
        last_entry_ago = 0
        if latest and latest["created_at"]:
            try:
                from datetime import datetime
                last = datetime.fromisoformat(latest["created_at"].split(".")[0])
                last_entry_ago = (datetime.utcnow() - last).days
            except Exception:
                pass

    return {
        "last_entry_ago":   last_entry_ago,
        "stats":            stats,
        "latest_entry":     latest,
        "open_questions":   open_questions,
        "contradictions":   contradictions,
        "shifting_concepts": shifting_concepts,
        "daily_prompt":     None,  # Generated by reminders system
    }


# ── Routes ─────────────────────────────────────────────────────────────────────
@router.get("/search")
def search(
    q:    str = Query(..., min_length=1),
    mode: str = Query("fulltext", regex="^(fulltext|semantic|concept)$"),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    if mode == "fulltext":
        results = fulltext_search(uid, q, limit)
    elif mode == "concept":
        results = concept_search(uid, q, limit)
    else:
        results = semantic_search(uid, q, limit)

    return {"results": results, "query": q, "mode": mode, "count": len(results)}


@router.get("/dashboard")
def dashboard(current_user: dict = Depends(get_current_user)):
    return get_dashboard_data(current_user["user_id"])


def register_search_routes(app):
    app.include_router(router)