"""
api.py — Main FastAPI application for Thought Biography
Registers all routes and contains core entry/graph endpoints.

All routes in one place:
  /health                          — connection check
  /auth/*                          — register, login, refresh, me, logout
  /entries                         — create and list journal entries
  /entries/{id}                    — get, update, delete a single entry
  /graph                           — full graph data for visualization
  /graph/stats                     — node/edge counts
  /concepts                        — list all concepts
  /concepts/{label}                — get a single concept + history
  /search                          — full-text, semantic, concept search
  /dashboard                       — home screen data
  /export                          — JSON, Markdown, graph topology
  /biography/*                     — AI biography generation (streaming)
  /reminders/*                     — reflection prompts, digest, settings
  /shares/*                        — create/revoke share links
  /shared/*                        — public shared graph viewer
  /transcribe                      — Whisper voice transcription

Run with:
  python api.py
  or
  uvicorn api:app --reload --port 8000
"""
from neo4j import GraphDatabase
import os
import uuid
import json
from datetime import datetime

def serialize_dt(val):
    """Convert Neo4j DateTime or string to clean ISO format JS can parse."""
    if val is None:
        return None
    s = str(val)
    # Neo4j DateTime str: "2026-06-17T16:13:18.594149000+00:00" — strip nanoseconds
    import re
    s = re.sub(r'(\.\d{3})\d+([\+\-Z])', r'', s)
    s = re.sub(r'(\.\d{3})\d+$', r'', s)
    return s
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from neo4j import GraphDatabase
import anthropic
from dotenv import load_dotenv

load_dotenv()

# ── Database + AI clients ─────────────────────────────────────────────────────
NEO4J_URI  = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "yourpassword")
driver     = GraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASSWORD)
)

claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# ── Import route registrars ───────────────────────────────────────────────────
from auth                  import register_auth_routes, get_current_user
from search_api            import register_search_routes
from export_api            import register_export_routes
from reminders_sharing_api import register_reminders_sharing_routes

# Biography routes (from biography_api.py — built in earlier session)
try:
    from biography_api import register_biography_routes
    BIOGRAPHY_AVAILABLE = True
except ImportError:
    BIOGRAPHY_AVAILABLE = False
    print("⚠ biography_api.py not found — biography routes disabled")

# Transcription route (from transcribe.py — built in earlier session)
try:
    from transcribe import router as transcribe_router
    TRANSCRIBE_AVAILABLE = True
except ImportError:
    TRANSCRIBE_AVAILABLE = False
    print("⚠ transcribe.py not found — transcription route disabled")


# ── Startup: create Neo4j indexes ─────────────────────────────────────────────
def setup_indexes():
    with driver.session() as s:
        indexes = [
            "CREATE INDEX entry_created   IF NOT EXISTS FOR (e:Entry)   ON (e.created_at)",
            "CREATE INDEX entry_user      IF NOT EXISTS FOR (e:Entry)   ON (e.user_id)",
            "CREATE INDEX concept_label   IF NOT EXISTS FOR (c:Concept) ON (c.label)",
            "CREATE INDEX concept_user    IF NOT EXISTS FOR (c:Concept) ON (c.user_id)",
            "CREATE INDEX person_name     IF NOT EXISTS FOR (p:Person)  ON (p.name)",
            "CREATE FULLTEXT INDEX entry_content IF NOT EXISTS FOR (e:Entry) ON EACH [e.content]",
            # Folder schema indexes - pre-creates labels so Neo4j stops warning about unknown types
            "CREATE INDEX folder_user       IF NOT EXISTS FOR (f:Folder)            ON (f.user_id)",
            "CREATE INDEX folder_id         IF NOT EXISTS FOR (f:Folder)            ON (f.id)",
            "CREATE INDEX suggestion_user   IF NOT EXISTS FOR (fs:FolderSuggestion) ON (fs.user_id)",
            "CREATE INDEX suggestion_status IF NOT EXISTS FOR (fs:FolderSuggestion) ON (fs.status)",
        ]
        for idx in indexes:
            try:
                s.run(idx)
            except Exception:
                pass  # index may already exist

        # Pre-register relationship types so Neo4j does not warn on first-use queries.
        # Creates and immediately deletes dummy nodes to touch the schema.
        try:
            s.run("""
                MERGE (df:Folder {id: '__schema_init__'})
                MERGE (dfs:FolderSuggestion {id: '__schema_init__'})
                MERGE (de:Entry {id: '__schema_init__'})
                ON CREATE SET de.user_id = '__schema_init__'
                MERGE (de)-[:IN_FOLDER]->(df)
                MERGE (de)-[:SUGGESTED_FOR]->(dfs)
                WITH df, dfs, de
                DETACH DELETE df, dfs, de
            """)
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_indexes()
    print("✓ Neo4j indexes ready")
    print("✓ Thought Biography API running")
    yield
    driver.close()


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Thought Biography API",
    description="Backend for Thought Biography — personal knowledge graph",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        os.getenv("FRONTEND_URL", ""),
    ],
    allow_origin_regex=r"https://.*\.up\.railway\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Register all route modules ────────────────────────────────────────────────
register_auth_routes(app)
register_search_routes(app)
register_export_routes(app)
register_reminders_sharing_routes(app)

from folders_api import register_folder_routes
register_folder_routes(app)

try:
    from stripe_api import register_stripe_routes
    register_stripe_routes(app)
    print("✓ stripe routes registered")
except Exception as e:
    print(f"⚠ stripe_api not loaded: {e}")

try:
    from limitless_import import register_import_routes
    register_import_routes(app)
    print("✓ limitless import routes registered")
except Exception as e:
    print(f"⚠ limitless_import not loaded: {e}")

if BIOGRAPHY_AVAILABLE:
    register_biography_routes(app)

if TRANSCRIBE_AVAILABLE:
    app.include_router(transcribe_router)


# ─────────────────────────────────────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["system"])
def health():
    """Frontend polls this every 30s to show the connection status dot."""
    try:
        with driver.session() as s:
            s.run("RETURN 1")
        db = "connected"
    except Exception:
        db = "unreachable"

    return {
        "status": "ok",
        "database": db,
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# ENTRIES  —  POST /entries  |  GET /entries  |  GET /entries/{id}
#             PUT /entries/{id}  |  DELETE /entries/{id}
# ─────────────────────────────────────────────────────────────────────────────

class CreateEntryRequest(BaseModel):
    content: str
    source:  str = "journal"       # journal | voice | import
    date:    str | None = None     # ISO date string, defaults to now

class UpdateEntryRequest(BaseModel):
    content: str | None = None
    is_indexed: bool | None = None


@app.post("/entries", tags=["entries"])
def create_entry(
    req: CreateEntryRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Create a new entry and process it through the AI pipeline.
    Returns the entry ID plus the extracted graph data.
    """
    # Free tier: max 30 entries
    _uid = current_user["user_id"]
    with driver.session() as _s:
        _plan_r = _s.run("MATCH (u:User {id:$uid}) RETURN coalesce(u.plan,'free') AS plan", uid=_uid).single()
        if (_plan_r["plan"] if _plan_r else "free") == "free":
            _cnt = _s.run("MATCH (e:Entry {user_id:$uid}) RETURN count(e) AS n", uid=_uid).single()
            if _cnt and _cnt["n"] >= 30:
                raise HTTPException(status_code=402, detail="Free tier limit reached (30 entries). Upgrade to Personal for unlimited entries.")
    uid        = current_user["user_id"]
    entry_id   = str(uuid.uuid4())
    created_at = req.date or datetime.utcnow().isoformat()

    # ── Step 1: Write raw entry to Neo4j ─────────────────────────────────────
    with driver.session() as s:
        s.run("""
            MATCH (u:User {id: $uid})
            CREATE (e:Entry {
                id:           $id,
                content:      $content,
                source:       $source,
                created_at:   datetime($created_at),
                user_id:      $uid,
                is_indexed:   false,
                word_count:   $word_count
            })
            CREATE (e)-[:BELONGS_TO]->(u)
        """, uid=uid, id=entry_id, content=req.content,
             source=req.source, created_at=created_at,
             word_count=len(req.content.split()))

    # ── Step 2: Extract structure via Claude ──────────────────────────────────
    extraction = extract_with_claude(req.content)

    # ── Step 3: Write extracted data to graph ─────────────────────────────────
    write_extraction_to_graph(uid, entry_id, extraction)

    # ── Step 4: Smart folders — auto-assign or queue a suggestion (non-fatal) ──
    try:
        from folders_api import process_entry_for_folders
        concept_labels = [c.get("label", "").strip() for c in extraction.get("concepts", []) if c.get("label")]
        process_entry_for_folders(uid, entry_id, concept_labels)
    except Exception as _fe:
        print(f"[folders] skipped for entry {entry_id}: {_fe}")

    return {
        "id":                entry_id,
        "created_at":        created_at,
        "word_count":        len(req.content.split()),
        "significance_score": extraction.get("significance_score", 0),
        "emotional_tone":    extraction.get("emotional_tone", ""),
        "concepts":          extraction.get("concepts", []),
        "open_question":     extraction.get("open_question"),
        "contradicts_concepts": extraction.get("contradicts_concepts", []),
        "reinforces_concepts":  extraction.get("reinforces_concepts", []),
    }


@app.get("/entries", tags=["entries"])
def list_entries(
    limit:  int = Query(20, ge=1, le=100),
    offset: int = Query(0,  ge=0),
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    with driver.session() as s:
        result = s.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid})
            OPTIONAL MATCH (e)-[:SURFACES]->(c:Concept)
            WITH e, collect(c.label)[0..5] AS concepts
            RETURN e, concepts
            ORDER BY e.created_at DESC
            SKIP $offset LIMIT $limit
        """, uid=uid, offset=offset, limit=limit)

        entries = []
        for r in result:
            e = dict(r["e"])
            e["created_at"] = serialize_dt(e.get("created_at"))
            e["concepts"]   = r["concepts"]
            e.pop("content", None)  # don't send full content in list
            e["excerpt"] = (dict(r["e"]).get("content") or "")[:280]
            entries.append(e)

        # Total count
        total = s.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id: $uid})
            RETURN count(e) AS n
        """, uid=uid).single()["n"]

    return {"entries": entries, "total": total, "offset": offset, "limit": limit}


@app.get("/entries/{entry_id}", tags=["entries"])
def get_entry(
    entry_id: str,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    with driver.session() as s:
        result = s.run("""
            MATCH (e:Entry {id: $id})-[:BELONGS_TO]->(:User {id: $uid})
            OPTIONAL MATCH (e)-[r:SURFACES]->(c:Concept)
            RETURN e, collect({label: c.label, weight: r.weight}) AS concepts
        """, id=entry_id, uid=uid).single()

    if not result:
        raise HTTPException(status_code=404, detail="Entry not found")

    e = dict(result["e"])
    e["created_at"] = serialize_dt(e.get("created_at"))
    e["concepts"]   = result["concepts"]
    return e


@app.put("/entries/{entry_id}", tags=["entries"])
def update_entry(
    entry_id: str,
    req: UpdateEntryRequest,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    with driver.session() as s:
        s.run("""
            MATCH (e:Entry {id: $id})-[:BELONGS_TO]->(:User {id: $uid})
            SET e += $props
        """, id=entry_id, uid=uid, props={
            k: v for k, v in req.dict().items() if v is not None
        })
    return {"status": "updated"}


@app.delete("/entries/{entry_id}", tags=["entries"])
def delete_entry(
    entry_id: str,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    with driver.session() as s:
        s.run("""
            MATCH (e:Entry {id: $id})-[:BELONGS_TO]->(:User {id: $uid})
            DETACH DELETE e
        """, id=entry_id, uid=uid)
    return {"status": "deleted"}


# ─────────────────────────────────────────────────────────────────────────────
# GRAPH  —  GET /graph  |  GET /graph/stats
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/graph", tags=["graph"])
def get_graph(current_user: dict = Depends(get_current_user)):
    """
    Returns all nodes and edges shaped for D3 force simulation.
    Used by ThoughtGraph.jsx and TemporalPlayback.jsx.
    """
    uid = current_user["user_id"]
    with driver.session() as s:

        # Nodes: concepts (primary), also people/sources if any
        nodes_r = s.run("""
            MATCH (n:Concept {user_id: $uid})
            RETURN
                n.id             AS id,
                n.label          AS label,
                'Concept'        AS type,
                coalesce(n.entry_count, 1)     AS frequency,
                coalesce(n.stability_score, 1) AS stability,
                coalesce(n.is_core, false)      AS is_core,
                n.first_seen     AS first_seen
        """, uid=uid)

        nodes = []
        for r in nodes_r:
            node = dict(r)
            node["first_seen"] = serialize_dt(node.get("first_seen"))
            nodes.append(node)

        # Edges — filter by user_id on concepts, use label for D3 matching
        edges_r = s.run("""
            MATCH (a:Concept {user_id: $uid})-[r:REINFORCES|CONTRADICTS|EVOLVED_INTO]->(b:Concept {user_id: $uid})
            WHERE NOT coalesce(r.resolved, false) AND a.label <> b.label
            RETURN
                a.label AS source,
                b.label AS target,
                type(r) AS type,
                coalesce(r.strength, r.tension_score, r.shift_magnitude, r.weight, 1.0) AS weight,
                r.first_observed AS first_observed
        """, uid=uid)

        node_labels = {n["label"] for n in nodes}
        edges = []
        for r in edges_r:
            edge = dict(r)
            edge["first_observed"] = serialize_dt(edge.get("first_observed"))
            if edge["source"] in node_labels and edge["target"] in node_labels:
                edges.append(edge)

        tensions     = sum(1 for e in edges if e["type"] == "CONTRADICTS")
        reinforcing  = sum(1 for e in edges if e["type"] == "REINFORCES")

        entry_count_r = s.run(
            "MATCH (e:Entry {user_id: $uid}) RETURN count(e) AS n", uid=uid
        ).single()
        entry_count = entry_count_r["n"] if entry_count_r else 0

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "concepts":       len(nodes),
            "entries":        entry_count,
            "contradictions": tensions,
            "reinforcing":    reinforcing,
        }
    }


@app.post("/contradictions/resolve", tags=["graph"])
def resolve_contradiction(
    body: dict,
    current_user: dict = Depends(get_current_user)
):
    uid = current_user["user_id"]
    ca  = body.get("concept_a", "")
    cb  = body.get("concept_b", "")
    note = body.get("resolution_note", "")
    with driver.session() as s:
        s.run("""
            MATCH (a:Concept {label: $ca, user_id: $uid})-[r:CONTRADICTS]->(b:Concept {label: $cb, user_id: $uid})
            SET r.resolved = true,
                r.resolved_at = datetime(),
                r.resolution_note = $note
        """, ca=ca, cb=cb, uid=uid, note=note)
        # Also try reverse direction
        s.run("""
            MATCH (a:Concept {label: $cb, user_id: $uid})-[r:CONTRADICTS]->(b:Concept {label: $ca, user_id: $uid})
            SET r.resolved = true,
                r.resolved_at = datetime(),
                r.resolution_note = $note
        """, ca=ca, cb=cb, uid=uid, note=note)
    return {"status": "resolved", "concept_a": ca, "concept_b": cb}


@app.post("/contradictions/analyze", tags=["graph"])
def analyze_contradiction(
    body: dict,
    current_user: dict = Depends(get_current_user)
):
    """Use Claude to explain why two concepts contradict and suggest resolution paths."""
    uid = current_user["user_id"]
    ca  = body.get("concept_a", "")
    cb  = body.get("concept_b", "")

    # Fetch journal entries that surface both concepts
    with driver.session() as s:
        rows = s.run("""
            MATCH (e:Entry {user_id: $uid})-[:SURFACES]->(c:Concept {user_id: $uid})
            WHERE c.label IN [$ca, $cb]
            WITH e, collect(c.label) AS concepts
            WHERE size(concepts) >= 1
            RETURN e.content AS content, concepts
            ORDER BY e.created_at DESC LIMIT 6
        """, uid=uid, ca=ca, cb=cb).data()

    # Build context from real entries
    context_lines = []
    for r in rows:
        snippet = (r["content"] or "")[:300]
        context_lines.append(f"[{', '.join(r['concepts'])}] {snippet}")
    context = "\n\n".join(context_lines) if context_lines else "No journal entries found yet."

    prompt = f"""You are analyzing a person's philosophical journal. Two concepts appear to be in tension:

CONCEPT A: {ca}
CONCEPT B: {cb}

RELEVANT JOURNAL EXCERPTS:
{context}

Respond in this exact JSON format, no markdown:
{{
  "why_contradiction": "2-3 sentences explaining why these two beliefs are in tension based on the journal excerpts above. Be specific and personal, not generic.",
  "resolution_paths": [
    {{
      "title": "Short title (4-6 words)",
      "description": "1-2 sentences describing this resolution path concretely."
    }},
    {{
      "title": "Short title (4-6 words)",
      "description": "1-2 sentences describing this resolution path concretely."
    }},
    {{
      "title": "Short title (4-6 words)",
      "description": "1-2 sentences describing this resolution path concretely."
    }}
  ]
}}"""

    resp = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    import json, re
    raw = resp.content[0].text.strip()
    raw = re.sub(r"^```json|^```|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    analysis = json.loads(raw)
    return analysis


@app.get("/graph/stats", tags=["graph"])
def get_graph_stats(current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with driver.session() as s:
        stats = {}
        queries = {
            "entries":        "MATCH (e:Entry)-[:BELONGS_TO]->(:User {id:$uid}) RETURN count(e) AS n",
            "concepts":       "MATCH (c:Concept)-[:BELONGS_TO]->(:User {id:$uid}) RETURN count(c) AS n",
            "contradictions": "MATCH ()-[r:CONTRADICTS {user_id:$uid}]->() RETURN count(r) AS n",
            "resolved":       "MATCH ()-[r:CONTRADICTS {user_id:$uid, resolved:true}]->() RETURN count(r) AS n",
            "influences":     "MATCH (p)-[:INTRODUCED|CATALYZED]->(:Concept {user_id:$uid}) RETURN count(DISTINCT p) AS n",
        }
        for key, q in queries.items():
            result = s.run(q, uid=uid).single()
            stats[key] = result["n"] if result else 0
    return stats


# ─────────────────────────────────────────────────────────────────────────────
# CONCEPTS  —  GET /concepts  |  GET /concepts/{label}
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/concepts", tags=["concepts"])
def list_concepts(
    core_only: bool = False,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    with driver.session() as s:
        where = "AND c.is_core = true" if core_only else ""
        result = s.run(f"""
            MATCH (c:Concept)-[:BELONGS_TO]->(:User {{id: $uid}})
            WHERE 1=1 {where}
            OPTIONAL MATCH (e:Entry)-[r:SURFACES]->(c)
            WITH c, count(e) AS entry_count,
                 collect(CASE WHEN e IS NOT NULL THEN {{date: toString(e.created_at), score: r.weight}} ELSE null END) AS raw_points
            RETURN c, entry_count, raw_points ORDER BY c.frequency DESC
        """, uid=uid)
        concepts = []
        for r in result:
            c = dict(r["c"])
            c["first_seen"] = serialize_dt(c.get("first_seen"))
            c["last_seen"]  = serialize_dt(c.get("last_seen"))
            c["entry_count"] = r["entry_count"]
            points = [p for p in (r["raw_points"] or []) if p and p.get("date")]
            points.sort(key=lambda p: p["date"])
            c["drift_points"] = points or None
            concepts.append(c)
    return {"concepts": concepts}


@app.get("/concepts/{label}/drift", tags=["concepts"])
def get_concept_drift(
    label: str,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    with driver.session() as s:
        result = s.run("""
            MATCH (c:Concept {label: $label})-[:BELONGS_TO]->(:User {id: $uid})
            OPTIONAL MATCH (e:Entry)-[r:SURFACES]->(c)
            WITH c, collect(CASE WHEN e IS NOT NULL THEN {date: toString(e.created_at), score: r.weight} ELSE null END) AS raw_points
            RETURN c, raw_points
        """, label=label, uid=uid).single()

        if not result:
            raise HTTPException(status_code=404, detail="Concept not found")

        concept = dict(result["c"])
        points = [p for p in (result["raw_points"] or []) if p and p.get("date")]
        points.sort(key=lambda p: p["date"])

        stability = concept.get("stability_score")
        stability = 1.0 if stability is None else stability
        if stability >= 0.75:
            direction = "stable"
        elif stability >= 0.45:
            direction = "shifting"
        else:
            direction = "transforming"

        narratives = {
            "stable": f"Your framing of {label} has been remarkably consistent across your entries.",
            "shifting": f"Your understanding of {label} has been moving in one direction across your entries.",
            "transforming": f"{label} has undergone a significant reframing across your entries.",
        }

    return {
        "concept": label,
        "points": points,
        "overall_direction": direction,
        "narrative": narratives[direction],
        "inflection_points": [],
    }


@app.get("/concepts/{label}", tags=["concepts"])
def get_concept(
    label: str,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    with driver.session() as s:
        # Concept node
        result = s.run("""
            MATCH (c:Concept {label: $label})-[:BELONGS_TO]->(:User {id: $uid})
            RETURN c
        """, label=label, uid=uid).single()

        if not result:
            raise HTTPException(status_code=404, detail="Concept not found")

        concept = dict(result["c"])
        concept["first_seen"] = serialize_dt(concept.get("first_seen"))
        concept["last_seen"]  = serialize_dt(concept.get("last_seen"))

        # Definition history (drift snapshots)
        snapshots_r = s.run("""
            MATCH (c:Concept {label: $label})-[d:HAD_DEFINITION]->(c)
            WHERE c.user_id = $uid
            RETURN d.at AS at, d.definition AS definition,
                   d.stability AS stability
            ORDER BY d.at
        """, label=label, uid=uid)
        concept["definition_history"] = [
            {"at": str(r["at"]), "definition": r["definition"], "stability": r["stability"]}
            for r in snapshots_r
        ]

        # Related concepts
        related_r = s.run("""
            MATCH (c:Concept {label: $label})-[r]-(other:Concept)
            WHERE c.user_id = $uid
            RETURN other.label AS label, type(r) AS relationship,
                   coalesce(r.strength, r.tension_score, 1.0) AS weight
            LIMIT 10
        """, label=label, uid=uid)
        concept["related"] = [dict(r) for r in related_r]

        # Source entries
        entries_r = s.run("""
            MATCH (e:Entry)-[s:SURFACES]->(c:Concept {label: $label})
            WHERE e.user_id = $uid
            RETURN e.id AS id, e.created_at AS date,
                   substring(e.content, 0, 200) AS excerpt,
                   s.weight AS weight
            ORDER BY e.created_at DESC LIMIT 5
        """, label=label, uid=uid)
        concept["entries"] = [
            {"id": r["id"], "date": str(r["date"]), "excerpt": r["excerpt"], "weight": r["weight"]}
            for r in entries_r
        ]

    return concept


# ─────────────────────────────────────────────────────────────────────────────
# INFLUENCE TREES  —  GET /influence-trees
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/influence-trees", tags=["graph"])
def get_influence_trees(current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with driver.session() as s:
        # Primary: Person/Source nodes with INTRODUCED/CATALYZED edges (new data)
        result = s.run("""
            MATCH (p)-[:INTRODUCED|CATALYZED]->(c:Concept)
            WHERE p.user_id = $uid OR c.user_id = $uid
            WITH p, collect(DISTINCT {
                id:    coalesce(c.id, c.label),
                label: c.label,
                weight: coalesce(p.influence_weight, 0.5)
            }) AS concepts
            RETURN
                coalesce(p.id, p.name, p.title) AS id,
                coalesce(p.name, p.title)        AS name,
                labels(p)[0]                     AS type,
                coalesce(p.influence_weight, size(concepts) * 0.1) AS impact_score,
                coalesce(p.first_mentioned, p.consumed_at) AS first_mentioned,
                concepts
            ORDER BY impact_score DESC
        """, uid=uid)

        influences = []
        seen = set()
        for r in result:
            inf = dict(r)
            inf["first_mentioned"] = str(inf.get("first_mentioned") or "")
            inf["impact_score"]    = float(inf.get("impact_score") or 0.5)
            key = inf.get("name") or inf.get("id")
            if key and key not in seen:
                seen.add(key)
                influences.append(inf)

        # Fallback: Person nodes connected via MENTIONS to entries (older data)
        if not influences:
            result2 = s.run("""
                MATCH (e:Entry {user_id: $uid})-[:MENTIONS]->(p:Person)
                WITH p, count(DISTINCT e) AS mention_count
                OPTIONAL MATCH (e2:Entry {user_id: $uid})-[:MENTIONS]->(p)
                WITH p, mention_count
                RETURN
                    coalesce(p.id, p.name) AS id,
                    p.name                 AS name,
                    'Person'               AS type,
                    mention_count * 0.2    AS impact_score,
                    p.first_mentioned      AS first_mentioned,
                    []                     AS concepts
                ORDER BY mention_count DESC
            """, uid=uid)
            for r in result2:
                inf = dict(r)
                inf["first_mentioned"] = str(inf.get("first_mentioned") or "")
                inf["impact_score"]    = float(inf.get("impact_score") or 0.1)
                influences.append(inf)

            result3 = s.run("""
                MATCH (e:Entry {user_id: $uid})-[:REFERENCES]->(s:Source)
                WITH s, count(DISTINCT e) AS ref_count
                RETURN
                    coalesce(s.id, s.title) AS id,
                    s.title                 AS name,
                    'Book'                  AS type,
                    ref_count * 0.2         AS impact_score,
                    s.consumed_at           AS first_mentioned,
                    []                      AS concepts
                ORDER BY ref_count DESC
            """, uid=uid)
            for r in result3:
                inf = dict(r)
                inf["first_mentioned"] = str(inf.get("first_mentioned") or "")
                inf["impact_score"]    = float(inf.get("impact_score") or 0.1)
                influences.append(inf)

    return {"influences": influences}


# ─────────────────────────────────────────────────────────────────────────────
# TEMPORAL DATA  —  GET /temporal-data
# Used by TemporalPlayback.jsx
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/temporal-data", tags=["graph"])
def get_temporal_data(current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with driver.session() as s:
        nodes_r = s.run("""
            MATCH (n)-[:BELONGS_TO]->(:User {id: $uid})
            WHERE n:Concept OR n:Person OR n:Source
            RETURN
                n.id       AS id,
                coalesce(n.label, n.name, n.title) AS label,
                labels(n)[0] AS type,
                coalesce(n.frequency, 1) AS frequency,
                toString(coalesce(n.first_seen, n.first_mentioned, datetime())) AS first_seen
        """, uid=uid)
        nodes = [dict(r) for r in nodes_r]

        edges_r = s.run("""
            MATCH (a)-[r]->(b)
            WHERE r.user_id = $uid
              AND type(r) IN ['REINFORCES','CONTRADICTS','EVOLVED_INTO','INTRODUCED']
            RETURN
                a.id AS source, b.id AS target,
                type(r) AS type,
                toString(coalesce(r.first_observed, datetime())) AS first_observed
        """, uid=uid)
        edges = [dict(r) for r in edges_r]

    all_dates = sorted(set(
        [n["first_seen"] for n in nodes if n.get("first_seen")] +
        [e["first_observed"] for e in edges if e.get("first_observed")]
    ))

    return {"nodes": nodes, "edges": edges, "all_dates": all_dates}


# ─────────────────────────────────────────────────────────────────────────────
# AI EXTRACTION  (used internally by create_entry)
# ─────────────────────────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are a philosophical analyst reading a journal entry.
Extract structured data and return ONLY valid JSON — no preamble, no markdown.

Return this exact shape:
{
  "significance_score": 0.0-1.0,
  "emotional_tone": "searching|resolved|ambivalent|certain|grieving|joyful|anxious|curious",
  "concepts": [
    {
      "label": "ConceptName",
      "weight": 0.0-1.0,
      "context_snippet": "the sentence where it appeared",
      "is_new_definition": true|false,
      "definition_note": "brief description of how this concept is framed"
    }
  ],
  "people_mentioned": ["Name1", "Name2"],
  "sources_referenced": ["Book/Article Title"],
  "contradicts_concepts": ["Concept1"],
  "reinforces_concepts": ["Concept2"],
  "open_question": "a single question the entry raises but doesn't answer, or null",
  "life_context_hint": "a short label for the life period, or null"
}"""


def extract_with_claude(content: str) -> dict:
    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1000,
            system=EXTRACTION_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
        text = response.content[0].text.strip()
        print(f"CLAUDE RAW RESPONSE: {text[:500]}")
        # Strip markdown fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception as e:
        import traceback
        print(f"Extraction error: {e}")
        traceback.print_exc()
        return {
            "significance_score": 0.5,
            "emotional_tone": "searching",
            "concepts": [],
            "people_mentioned": [],
            "sources_referenced": [],
            "contradicts_concepts": [],
            "reinforces_concepts": [],
            "open_question": None,
            "life_context_hint": None,
        }


def write_extraction_to_graph(user_id: str, entry_id: str, extraction: dict):
    """Write all Claude-extracted data into Neo4j."""
    with driver.session() as s:

        # Update entry with extracted metadata
        s.run("""
            MATCH (e:Entry {id: $id})
            SET e.significance_score = $sig,
                e.emotional_tone     = $tone,
                e.open_question      = $oq,
                e.is_indexed         = true
        """, id=entry_id,
             sig=extraction.get("significance_score", 0.5),
             tone=extraction.get("emotional_tone", ""),
             oq=extraction.get("open_question"))

        # Create/update concept nodes and SURFACES edges
        for concept in extraction.get("concepts", []):
            label = concept.get("label", "").strip()
            if not label:
                continue

            s.run("""
                MERGE (c:Concept {label: $label, user_id: $uid})
                ON CREATE SET
                    c.id              = $cid,
                    c.first_seen      = datetime(),
                    c.frequency       = 1,
                    c.stability_score = 1.0,
                    c.is_core         = false,
                    c.user_id         = $uid
                ON MATCH SET
                    c.frequency  = c.frequency + 1,
                    c.last_seen  = datetime()
                WITH c
                MATCH (u:User {id: $uid})
                MERGE (c)-[:BELONGS_TO]->(u)
            """, label=label, uid=user_id, cid=str(uuid.uuid4()))

            s.run("""
                MATCH (e:Entry {id: $eid})
                MATCH (c:Concept {label: $label, user_id: $uid})
                MERGE (e)-[r:SURFACES]->(c)
                SET r.weight           = $weight,
                    r.context_snippet  = $snippet
                WITH c
                MATCH (e2:Entry)-[:SURFACES]->(c)
                WITH c, count(e2) AS ec
                SET c.entry_count = ec
            """, eid=entry_id, label=label, uid=user_id,
                 weight=concept.get("weight", 0.5),
                 snippet=concept.get("context_snippet", ""))

        # Contradiction edges
        for c_label in extraction.get("contradicts_concepts", []):
            s.run("""
                MATCH (c1:Concept {label: $l1, user_id: $uid})
                MATCH (c2:Concept {label: $l2, user_id: $uid})
                MERGE (c1)-[r:CONTRADICTS]->(c2)
                ON CREATE SET
                    r.first_observed = datetime(),
                    r.tension_score  = 0.6,
                    r.resolved       = false,
                    r.user_id        = $uid
            """, l1=extraction["concepts"][0]["label"] if extraction.get("concepts") else "",
                 l2=c_label, uid=user_id)

        # Reinforces edges
        for r_label in extraction.get("reinforces_concepts", []):
            s.run("""
                MATCH (c1:Concept {label: $l1, user_id: $uid})
                MATCH (c2:Concept {label: $l2, user_id: $uid})
                MERGE (c1)-[r:REINFORCES]->(c2)
                ON CREATE SET
                    r.first_observed = datetime(),
                    r.strength       = 0.5,
                    r.user_id        = $uid
                ON MATCH SET
                    r.strength = r.strength + 0.05
            """, l1=extraction["concepts"][0]["label"] if extraction.get("concepts") else "",
                 l2=r_label, uid=user_id)

        # People nodes
        for name in extraction.get("people_mentioned", []):
            s.run("""
                MERGE (p:Person {name: $name, user_id: $uid})
                ON CREATE SET
                    p.id              = $pid,
                    p.type            = 'person',
                    p.first_mentioned = datetime(),
                    p.influence_weight = 0.0,
                    p.user_id         = $uid
            """, name=name, uid=user_id, pid=str(uuid.uuid4()))

            # Link person to concepts mentioned in same entry
            for concept in extraction.get("concepts", []):
                s.run("""
                    MATCH (p:Person {name: $name, user_id: $uid})
                    MATCH (c:Concept {label: $label, user_id: $uid})
                    MERGE (p)-[r:INTRODUCED]->(c)
                    ON CREATE SET
                        r.via_entry = $eid,
                        r.at        = datetime(),
                        r.user_id   = $uid
                    WITH p
                    SET p.influence_weight = coalesce(p.influence_weight, 0.0) + 0.1
                """, name=name, label=concept.get("label"), uid=user_id, eid=entry_id)

        # Source nodes + CATALYZED edges to concepts
        for title in extraction.get("sources_referenced", []):
            s.run("""
                MERGE (src:Source {title: $title, user_id: $uid})
                ON CREATE SET
                    src.id             = $sid,
                    src.type           = 'Book',
                    src.consumed_at    = datetime(),
                    src.influence_weight = 0.0,
                    src.user_id        = $uid
            """, title=title, uid=user_id, sid=str(uuid.uuid4()))

            for concept in extraction.get("concepts", []):
                clabel = concept.get("label", "").strip()
                if not clabel:
                    continue
                s.run("""
                    MATCH (src:Source {title: $title, user_id: $uid})
                    MATCH (c:Concept {label: $label, user_id: $uid})
                    MERGE (src)-[r:CATALYZED]->(c)
                    ON CREATE SET
                        r.via_entry = $eid,
                        r.at        = datetime(),
                        r.user_id   = $uid
                    WITH src
                    SET src.influence_weight = coalesce(src.influence_weight, 0.0) + 0.1
                """, title=title, label=clabel, uid=user_id, eid=entry_id)

        # Life context
        if extraction.get("life_context_hint"):
            s.run("""
                MERGE (lc:LifeContext {label: $label, user_id: $uid})
                ON CREATE SET
                    lc.id       = $lid,
                    lc.start    = datetime(),
                    lc.user_id  = $uid
                WITH lc
                MATCH (e:Entry {id: $eid})
                MERGE (e)-[:OCCURRED_DURING]->(lc)
            """, label=extraction["life_context_hint"],
                 uid=user_id, lid=str(uuid.uuid4()), eid=entry_id)


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=True,
    )