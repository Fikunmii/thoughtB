"""
limitless_import.py — Limitless / Rewind Data Import for Thought Biography
───────────────────────────────────────────────────────────────────────────
Accepts a user's exported Limitless (formerly Rewind) data archive and
ingests it into the Thought Biography knowledge graph.

Limitless export formats supported:
  - JSON transcript archive  (transcripts.json)
  - Individual session JSON  (session_YYYY-MM-DD.json)
  - ZIP file containing either of the above

What it does:
  1. Parses the archive into normalised session records
  2. Deduplicates against entries already in the graph
  3. Runs each session through the concept extraction pipeline
  4. Writes entries and concepts to Neo4j exactly as a typed journal entry would
  5. Tags all imported entries with source: "limitless_import" for traceability
  6. Returns a full import report

Routes:
  POST /import/limitless              — upload and start import (multipart)
  GET  /import/limitless/status/{id} — poll import job status
  GET  /import/limitless/history     — list all previous imports for this user
  DELETE /import/limitless/{id}      — delete an import batch (and its entries)

Register in api.py:
  from limitless_import import register_import_routes
  register_import_routes(app)
"""

import os
import io
import json
import uuid
import zipfile
import logging
from datetime import datetime
from typing import Optional

import anthropic
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("limitless_import")

# ── Clients ───────────────────────────────────────────────────────────────────
NEO4J_URI  = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "yourpassword")
driver     = GraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASSWORD)
)

claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

router = APIRouter(prefix="/import", tags=["import"])

# Max file size: 50MB
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

# Minimum transcript length worth processing (words)
MIN_WORDS = 30


# ── Limitless export format parsers ──────────────────────────────────────────

def parse_limitless_zip(data: bytes) -> list[dict]:
    """Extract and parse all JSON files from a Limitless ZIP export."""
    sessions = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for name in zf.namelist():
            if not name.endswith(".json"):
                continue
            try:
                content = json.loads(zf.read(name))
                sessions.extend(_normalise(content, source_filename=name))
            except Exception as e:
                log.warning(f"Skipping {name}: {e}")
    return sessions


def parse_limitless_json(data: bytes) -> list[dict]:
    """Parse a single Limitless JSON export (transcripts.json or session file)."""
    try:
        content = json.loads(data)
        return _normalise(content)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}")


def _normalise(content, source_filename: str = "") -> list[dict]:
    """
    Convert Limitless export JSON into a flat list of normalised session dicts.

    Limitless exports come in several shapes depending on export date and
    account type. We handle all known variants:

    Shape A — Array of session objects (most common):
      [{"id": "...", "date": "...", "transcript": "...", "summary": "..."}, ...]

    Shape B — Object with a "transcripts" or "sessions" key:
      {"transcripts": [...]}  /  {"sessions": [...]}

    Shape C — Single session object:
      {"id": "...", "date": "...", "transcript": "..."}

    Shape D — Rewind legacy format with "memories" key:
      {"memories": [{"timestamp": "...", "text": "...", "type": "..."}]}

    For all shapes, we extract:
      - date (ISO string)
      - text (the transcript or memory text)
      - summary (if present)
      - duration_seconds (if present)
      - original_id (Limitless session ID, for deduplication)
      - tags (if present)
    """
    sessions = []

    # Shape B
    if isinstance(content, dict):
        if "transcripts" in content:
            content = content["transcripts"]
        elif "sessions" in content:
            content = content["sessions"]
        elif "memories" in content:
            # Shape D — Rewind legacy
            for m in content["memories"]:
                text = m.get("text", "").strip()
                if len(text.split()) < MIN_WORDS:
                    continue
                sessions.append({
                    "original_id":      m.get("id", str(uuid.uuid4())),
                    "date":             _parse_date(m.get("timestamp", "")),
                    "text":             text,
                    "summary":          "",
                    "duration_seconds": 0,
                    "tags":             [m.get("type", "memory")],
                    "source_format":    "rewind_legacy",
                    "source_filename":  source_filename,
                })
            return sessions
        else:
            # Shape C — single session
            content = [content]

    # Shape A / B unwrapped
    if not isinstance(content, list):
        log.warning(f"Unrecognised Limitless format in {source_filename}")
        return []

    for item in content:
        if not isinstance(item, dict):
            continue

        # Extract transcript text — try multiple known field names
        text = (
            item.get("transcript") or
            item.get("transcription") or
            item.get("content") or
            item.get("text") or
            item.get("body") or
            ""
        ).strip()

        # Some exports have speaker-diarised transcripts as arrays
        if not text and "segments" in item:
            text = " ".join(
                seg.get("text", "") for seg in item["segments"]
                if isinstance(seg, dict)
            ).strip()

        if len(text.split()) < MIN_WORDS:
            continue

        # Extract date — try multiple known field names
        raw_date = (
            item.get("date") or
            item.get("timestamp") or
            item.get("created_at") or
            item.get("started_at") or
            ""
        )

        sessions.append({
            "original_id":      item.get("id") or item.get("session_id") or str(uuid.uuid4()),
            "date":             _parse_date(raw_date),
            "text":             text,
            "summary":          item.get("summary") or item.get("overview") or "",
            "duration_seconds": item.get("duration") or item.get("duration_seconds") or 0,
            "tags":             item.get("tags") or [],
            "source_format":    "limitless",
            "source_filename":  source_filename,
        })

    return sessions


def _parse_date(raw: str) -> str:
    """Best-effort ISO date parsing. Returns today's date if unparseable."""
    if not raw:
        return datetime.utcnow().isoformat()
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
    ):
        try:
            return datetime.strptime(raw[:len(fmt)+4], fmt).isoformat()
        except (ValueError, TypeError):
            continue
    return datetime.utcnow().isoformat()


# ── Deduplication ─────────────────────────────────────────────────────────────

def filter_duplicates(sessions: list[dict], user_id: str) -> list[dict]:
    """
    Remove sessions that have already been imported for this user.
    Checks against stored original_id values in Neo4j.
    """
    if not sessions:
        return []

    original_ids = [s["original_id"] for s in sessions]

    with driver.session() as s:
        existing = s.run("""
            MATCH (e:Entry {user_id: $uid})
            WHERE e.limitless_original_id IN $ids
            RETURN e.limitless_original_id AS oid
        """, uid=user_id, ids=original_ids).data()

    already_imported = {r["oid"] for r in existing}
    new_sessions = [s for s in sessions if s["original_id"] not in already_imported]

    log.info(
        f"Deduplication: {len(sessions)} total, "
        f"{len(already_imported)} already imported, "
        f"{len(new_sessions)} new"
    )
    return new_sessions


# ── Concept extraction (reuses same Claude pipeline as typed entries) ─────────

def extract_concepts_from_session(text: str, date: str) -> dict:
    """
    Run Claude concept extraction on one session transcript.
    Returns structured concept data identical to what a typed entry produces.
    """
    prompt = f"""You are analysing a journal entry or spoken transcript to extract its core concepts.

Date: {date}
Text:
\"\"\"
{text[:4000]}
\"\"\"

Extract the intellectual concepts, beliefs, values, and ideas present in this text.
For each concept, identify:
1. The concept name (2-5 words, specific)
2. How it is framed in this text (1 sentence)
3. Sentiment: positive / negative / neutral / ambivalent
4. Importance: core / supporting / peripheral

Also identify:
- Any people mentioned as intellectual influences (authors, thinkers, etc.)
- Any books, articles, or works referenced

Return ONLY valid JSON in exactly this structure:
{{
  "concepts": [
    {{
      "label": "string",
      "framing": "string",
      "sentiment": "positive|negative|neutral|ambivalent",
      "importance": "core|supporting|peripheral"
    }}
  ],
  "influences": [
    {{
      "name": "string",
      "type": "person|book|article|podcast|film|other"
    }}
  ],
  "summary": "One sentence summary of the main idea in this entry."
}}"""

    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.content[0].text.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        log.warning(f"Could not parse concept extraction JSON: {raw[:200]}")
        return {"concepts": [], "influences": [], "summary": ""}


# ── Neo4j write pipeline ──────────────────────────────────────────────────────

def write_session_to_graph(session: dict, user_id: str,
                            import_batch_id: str, extraction: dict) -> str:
    """
    Write one imported session as an Entry node and connect its concepts.
    Returns the new entry_id.
    """
    entry_id = str(uuid.uuid4())

    with driver.session() as s:

        # Create Entry node — identical schema to typed entries
        s.run("""
            MATCH (u:User {id: $uid})
            CREATE (e:Entry {
                id:                     $eid,
                user_id:                $uid,
                content:                $content,
                word_count:             $wc,
                created_at:             $created_at,
                source:                 'limitless_import',
                limitless_original_id:  $original_id,
                import_batch_id:        $batch_id,
                ai_summary:             $summary
            })
            CREATE (u)-[:AUTHORED]->(e)
        """,
            uid=user_id,
            eid=entry_id,
            content=session["text"][:10000],   # cap at 10k chars
            wc=len(session["text"].split()),
            created_at=session["date"],
            original_id=session["original_id"],
            batch_id=import_batch_id,
            summary=extraction.get("summary", ""),
        )

        # Create/merge Concept nodes and CONTAINS relationships
        for concept in extraction.get("concepts", []):
            label = concept.get("label", "").strip()
            if not label:
                continue

            s.run("""
                MATCH (u:User {id: $uid}), (e:Entry {id: $eid})
                MERGE (c:Concept {label: $label, user_id: $uid})
                ON CREATE SET
                    c.id           = $cid,
                    c.first_seen   = $date,
                    c.last_seen    = $date,
                    c.entry_count  = 1,
                    c.stability_score = 0
                ON MATCH SET
                    c.previous_seen = c.last_seen,
                    c.last_seen     = $date,
                    c.entry_count   = coalesce(c.entry_count, 0) + 1
                MERGE (u)-[:OWNS]->(c)
                CREATE (e)-[:CONTAINS {
                    sentiment:  $sentiment,
                    importance: $importance,
                    framing:    $framing
                }]->(c)
            """,
                uid=user_id,
                eid=entry_id,
                cid=str(uuid.uuid4()),
                label=label,
                date=session["date"],
                sentiment=concept.get("sentiment", "neutral"),
                importance=concept.get("importance", "supporting"),
                framing=concept.get("framing", ""),
            )

        # Create/merge influence (Person/Book) nodes
        for influence in extraction.get("influences", []):
            name = influence.get("name", "").strip()
            if not name:
                continue
            itype = influence.get("type", "person")
            node_label = "Person" if itype == "person" else "Source"

            s.run(f"""
                MATCH (e:Entry {{id: $eid}})
                MERGE (src:{node_label} {{name: $name, user_id: $uid}})
                ON CREATE SET src.id = $sid, src.type = $itype, src.first_seen = $date
                MERGE (e)-[:REFERENCES]->(src)
            """,
                eid=entry_id,
                uid=user_id,
                name=name,
                sid=str(uuid.uuid4()),
                itype=itype,
                date=session["date"],
            )

    return entry_id


# ── Import job runner ─────────────────────────────────────────────────────────

def run_import_job(sessions: list[dict], user_id: str, import_batch_id: str):
    """
    Process all sessions for one import job.
    Updates the ImportJob node in Neo4j with progress.
    """
    total    = len(sessions)
    imported = 0
    failed   = 0

    def update_progress():
        with driver.session() as s:
            s.run("""
                MATCH (j:ImportJob {id: $jid})
                SET j.processed = $processed,
                    j.imported  = $imported,
                    j.failed    = $failed,
                    j.updated_at = $ts
            """, jid=import_batch_id, processed=imported + failed,
                 imported=imported, failed=failed,
                 ts=datetime.utcnow().isoformat())

    for i, session in enumerate(sessions):
        try:
            extraction = extract_concepts_from_session(session["text"], session["date"])
            write_session_to_graph(session, user_id, import_batch_id, extraction)
            imported += 1
        except Exception as e:
            log.error(f"Failed to import session {session['original_id']}: {e}")
            failed += 1

        # Update progress every 5 sessions
        if (i + 1) % 5 == 0 or i == total - 1:
            update_progress()

    # Mark job complete
    with driver.session() as s:
        s.run("""
            MATCH (j:ImportJob {id: $jid})
            SET j.status     = 'complete',
                j.completed_at = $ts,
                j.imported   = $imported,
                j.failed     = $failed,
                j.processed  = $total
        """, jid=import_batch_id, ts=datetime.utcnow().isoformat(),
             imported=imported, failed=failed, total=total)

    log.info(
        f"Import {import_batch_id} complete: "
        f"{imported}/{total} imported, {failed} failed"
    )


# ── Routes ────────────────────────────────────────────────────────────────────

def _current_user():
    from auth import get_current_user
    return Depends(get_current_user)


@router.post("/limitless")
async def upload_limitless_export(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: dict = _current_user(),
):
    """
    Upload a Limitless or Rewind export file.
    Accepts: .json, .zip
    Returns immediately with a job ID. Poll /import/limitless/status/{id} for progress.
    """
    # Validate file type
    filename = file.filename or ""
    if not (filename.endswith(".json") or filename.endswith(".zip")):
        raise HTTPException(400, "File must be .json or .zip")

    # Read and size-check
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large. Maximum size: {MAX_UPLOAD_BYTES // (1024*1024)}MB")

    # Parse
    try:
        if filename.endswith(".zip"):
            sessions = parse_limitless_zip(data)
        else:
            sessions = parse_limitless_json(data)
    except (ValueError, zipfile.BadZipFile) as e:
        raise HTTPException(422, f"Could not parse export file: {e}")

    if not sessions:
        raise HTTPException(422,
            "No usable transcripts found in this file. "
            "Make sure you exported from Limitless or Rewind with transcripts included.")

    # Deduplicate
    user_id  = current_user["user_id"]
    sessions = filter_duplicates(sessions, user_id)

    if not sessions:
        return {
            "status":  "nothing_new",
            "message": "All sessions in this file have already been imported.",
            "total_in_file": len(sessions),
        }

    # Create ImportJob node
    job_id = str(uuid.uuid4())
    date_range = _get_date_range(sessions)

    with driver.session() as s:
        s.run("""
            MATCH (u:User {id: $uid})
            CREATE (j:ImportJob {
                id:           $jid,
                user_id:      $uid,
                status:       'processing',
                total:        $total,
                processed:    0,
                imported:     0,
                failed:       0,
                filename:     $filename,
                date_from:    $date_from,
                date_to:      $date_to,
                created_at:   $ts
            })
            CREATE (u)-[:HAS_IMPORT]->(j)
        """,
            uid=user_id,
            jid=job_id,
            total=len(sessions),
            filename=filename,
            date_from=date_range["from"],
            date_to=date_range["to"],
            ts=datetime.utcnow().isoformat(),
        )

    # Run in background — don't block the HTTP response
    background_tasks.add_task(run_import_job, sessions, user_id, job_id)

    return {
        "job_id":      job_id,
        "status":      "processing",
        "total":       len(sessions),
        "date_range":  date_range,
        "message":     (
            f"Import started. Processing {len(sessions)} sessions. "
            f"This may take a few minutes. "
            f"Poll /import/limitless/status/{job_id} for progress."
        ),
    }


@router.get("/limitless/status/{job_id}")
def get_import_status(
    job_id: str,
    current_user: dict = _current_user(),
):
    """Poll the status of an import job."""
    with driver.session() as s:
        result = s.run("""
            MATCH (j:ImportJob {id: $jid, user_id: $uid})
            RETURN j.status       AS status,
                   j.total        AS total,
                   j.processed    AS processed,
                   j.imported     AS imported,
                   j.failed       AS failed,
                   j.date_from    AS date_from,
                   j.date_to      AS date_to,
                   j.created_at   AS created_at,
                   j.completed_at AS completed_at,
                   j.filename     AS filename
        """, jid=job_id, uid=current_user["user_id"]).single()

    if not result:
        raise HTTPException(404, "Import job not found")

    r = dict(result)
    r["progress_pct"] = (
        round(r["processed"] / r["total"] * 100) if r["total"] else 100
    )
    return r


@router.get("/limitless/history")
def get_import_history(current_user: dict = _current_user()):
    """List all previous imports for this user."""
    with driver.session() as s:
        results = s.run("""
            MATCH (u:User {id: $uid})-[:HAS_IMPORT]->(j:ImportJob)
            RETURN j.id          AS job_id,
                   j.status      AS status,
                   j.total       AS total,
                   j.imported    AS imported,
                   j.failed      AS failed,
                   j.filename    AS filename,
                   j.date_from   AS date_from,
                   j.date_to     AS date_to,
                   j.created_at  AS created_at,
                   j.completed_at AS completed_at
            ORDER BY j.created_at DESC
        """, uid=current_user["user_id"]).data()

    return {"imports": results, "total": len(results)}


@router.delete("/limitless/{job_id}")
def delete_import_batch(
    job_id: str,
    current_user: dict = _current_user(),
):
    """
    Delete an import batch and all entries it created.
    Does NOT delete concepts that were also written by other entries.
    """
    user_id = current_user["user_id"]

    # Verify ownership
    with driver.session() as s:
        job = s.run("""
            MATCH (j:ImportJob {id: $jid, user_id: $uid})
            RETURN j.imported AS imported
        """, jid=job_id, uid=user_id).single()

    if not job:
        raise HTTPException(404, "Import job not found")

    imported_count = job["imported"] or 0

    # Delete entries from this batch (Neo4j cascades relationships)
    with driver.session() as s:
        result = s.run("""
            MATCH (e:Entry {import_batch_id: $bid, user_id: $uid})
            DETACH DELETE e
            RETURN count(e) AS deleted
        """, bid=job_id, uid=user_id).single()

        deleted = result["deleted"] if result else 0

        # Delete the job node
        s.run("""
            MATCH (j:ImportJob {id: $jid, user_id: $uid})
            DETACH DELETE j
        """, jid=job_id, uid=user_id)

    return {
        "status":        "deleted",
        "entries_deleted": deleted,
        "message": (
            f"Deleted {deleted} imported entries. "
            "Concepts that appeared in your own entries are preserved."
        ),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_date_range(sessions: list[dict]) -> dict:
    dates = sorted(s["date"] for s in sessions if s.get("date"))
    return {
        "from": dates[0][:10]  if dates else "",
        "to":   dates[-1][:10] if dates else "",
    }


# ── Register ──────────────────────────────────────────────────────────────────

def register_import_routes(app):
    app.include_router(router)

