"""
file_import.py — Generic File Import for Thought Biography
───────────────────────────────────────────────────────────
Accepts any file the user wants to import into their graph:
  - Plain text (.txt, .md)
  - PDF (.pdf)
  - Microsoft Word (.docx)
  - Limitless/Rewind export (.json, .zip)  ← existing format still supported

Each file is extracted to text, then processed through the same concept
extraction pipeline as a typed journal entry.

Routes:
  POST /import/file            — upload any file
  GET  /import/file/history    — list all imports for this user (all types)
  DELETE /import/file/{id}     — delete an import batch
"""

import os
import io
import json
import uuid
import zipfile
import logging
from datetime import datetime, timezone
from typing import Optional

import anthropic
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import JSONResponse
from neo4j import GraphDatabase

log = logging.getLogger("file_import")

NEO4J_URI      = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER     = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

router = APIRouter(prefix="/import", tags=["import"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
MIN_WORDS        = 20


# ── Auth helpers (mirrors limitless_import exactly) ───────────────────────────

def _current_user():
    from auth import get_current_user
    return Depends(get_current_user)


def _subscribed_user():
    from auth import require_subscription
    return Depends(require_subscription)


# ── Text extractors ───────────────────────────────────────────────────────────

def extract_txt(data: bytes) -> str:
    """Plain text / markdown."""
    return data.decode("utf-8", errors="replace")


def extract_pdf(data: bytes) -> str:
    """Extract text from PDF using pypdf (pure Python, no system deps)."""
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(data))
        pages = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text.strip():
                pages.append(text.strip())
        return "\n\n".join(pages)
    except ImportError:
        raise HTTPException(500, "PDF support unavailable — pypdf not installed.")
    except Exception as e:
        raise HTTPException(422, f"Could not parse PDF: {e}")


def extract_docx(data: bytes) -> str:
    """Extract text from DOCX."""
    try:
        from docx import Document
        doc = Document(io.BytesIO(data))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n\n".join(paragraphs)
    except ImportError:
        raise HTTPException(500, "DOCX support unavailable — python-docx not installed.")
    except Exception as e:
        raise HTTPException(422, f"Could not parse DOCX: {e}")


def extract_limitless_json(data: bytes) -> list[str]:
    """Parse Limitless/Rewind JSON export into list of text chunks."""
    try:
        payload = json.loads(data)
    except Exception as e:
        raise HTTPException(422, f"Invalid JSON: {e}")

    chunks = []

    def _pull_text(obj):
        if isinstance(obj, str):
            return obj
        if isinstance(obj, dict):
            for key in ("transcript", "text", "content", "summary", "body"):
                if key in obj and isinstance(obj[key], str):
                    return obj[key]
            # recurse into lists
            for val in obj.values():
                if isinstance(val, (list, dict)):
                    sub = _pull_text(val)
                    if sub:
                        return sub
        if isinstance(obj, list):
            parts = [_pull_text(i) for i in obj if _pull_text(i)]
            return "\n\n".join(parts)
        return ""

    if isinstance(payload, list):
        for item in payload:
            text = _pull_text(item)
            if text and len(text.split()) >= MIN_WORDS:
                chunks.append(text)
    else:
        text = _pull_text(payload)
        if text and len(text.split()) >= MIN_WORDS:
            chunks.append(text)

    return chunks


def extract_limitless_zip(data: bytes) -> list[str]:
    """Extract all text from a Limitless ZIP archive."""
    chunks = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for name in zf.namelist():
                if name.endswith(".json"):
                    try:
                        more = extract_limitless_json(zf.read(name))
                        chunks.extend(more)
                    except Exception:
                        pass
                elif name.endswith((".txt", ".md")):
                    try:
                        text = zf.read(name).decode("utf-8", errors="replace")
                        if len(text.split()) >= MIN_WORDS:
                            chunks.append(text)
                    except Exception:
                        pass
    except zipfile.BadZipFile:
        raise HTTPException(422, "Invalid ZIP file.")
    return chunks


def chunks_from_long_text(text: str, max_words: int = 800) -> list[str]:
    """Split a long document into ~800-word chunks at paragraph boundaries."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks, current, count = [], [], 0
    for para in paragraphs:
        words = len(para.split())
        if count + words > max_words and current:
            chunks.append("\n\n".join(current))
            current, count = [para], words
        else:
            current.append(para)
            count += words
    if current:
        chunks.append("\n\n".join(current))
    return chunks if chunks else [text]


# ── Concept extraction (reused from ingest pipeline) ─────────────────────────

def extract_concepts_from_text(text: str) -> dict:
    """Call Claude to extract concepts, questions, tone from a text chunk."""
    prompt = f"""Analyse this text and extract structured insights for a personal knowledge graph.

TEXT:
{text[:4000]}

Return JSON only — no markdown, no preamble:
{{
  "concepts": ["concept1", "concept2"],
  "open_question": "A single open question this text raises, or null",
  "emotional_tone": "one word (e.g. reflective, anxious, hopeful, resolved)",
  "significance_score": 0.0-1.0,
  "summary": "One sentence capturing the core thought"
}}"""

    try:
        resp = claude.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        return json.loads(raw)
    except Exception as e:
        log.warning("Concept extraction failed: %s", e)
        return {
            "concepts": [],
            "open_question": None,
            "emotional_tone": "neutral",
            "significance_score": 0.5,
            "summary": text[:200],
        }


# ── Neo4j write ───────────────────────────────────────────────────────────────

def write_chunk_to_graph(session, user_id: str, text: str, extracted: dict,
                         job_id: str, source_label: str) -> str:
    """Write one text chunk as an Entry node with concepts. Returns entry_id."""
    entry_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    session.run("""
        MATCH (u:User {id: $user_id})
        CREATE (e:Entry {
            id: $entry_id,
            content: $content,
            created_at: datetime($now),
            source: $source,
            import_job_id: $job_id,
            user_id: $user_id,
            emotional_tone: $tone,
            significance_score: $sig,
            open_question: $question,
            word_count: $wc,
            is_indexed: true
        })
        CREATE (u)-[:AUTHORED]->(e)
        CREATE (lc:LifeContext {
            id: $lc_id, entry_id: $entry_id, user_id: $user_id,
            created_at: datetime($now)
        })
        CREATE (e)-[:OCCURRED_DURING]->(lc)
    """, user_id=user_id, entry_id=entry_id, content=text,
         now=now, source=source_label, job_id=job_id,
         tone=extracted.get("emotional_tone", "neutral"),
         sig=float(extracted.get("significance_score", 0.5)),
         question=extracted.get("open_question"),
         wc=len(text.split()),
         lc_id=str(uuid.uuid4()))

    for concept_name in extracted.get("concepts", []):
        if not concept_name or len(concept_name) > 100:
            continue
        label = concept_name.strip().title().replace(" ", "")
        session.run("""
            MATCH (e:Entry {id: $entry_id})
            MERGE (c:Concept {name: $name, user_id: $user_id})
            ON CREATE SET c.label = $label, c.created_at = datetime($now),
                          c.entry_count = 1
            ON MATCH SET  c.entry_count = coalesce(c.entry_count, 0) + 1
            MERGE (e)-[:SURFACES]->(c)
            MERGE (e)-[:BELONGS_TO]->(c)
        """, entry_id=entry_id, name=concept_name, label=label,
             user_id=user_id, now=now)

    return entry_id


def _update_job(job_id: str, **kwargs):
    with driver.session() as s:
        set_parts = ", ".join(f"j.{k} = ${k}" for k in kwargs)
        s.run(f"MATCH (j:ImportJob {{job_id: $job_id}}) SET {set_parts}",
              job_id=job_id, **kwargs)


# ── Background import task ────────────────────────────────────────────────────

def run_import(job_id: str, user_id: str, chunks: list[str], source_label: str):
    total = len(chunks)
    imported = 0
    failed = 0

    for i, text in enumerate(chunks):
        try:
            extracted = extract_concepts_from_text(text)
            with driver.session() as s:
                write_chunk_to_graph(s, user_id, text, extracted, job_id, source_label)
            imported += 1
        except Exception as e:
            log.warning("Chunk %d failed: %s", i, e)
            failed += 1

        pct = int(((i + 1) / total) * 100)
        _update_job(job_id, processed=i + 1, imported=imported,
                    failed=failed, progress_pct=pct, status="processing")

    _update_job(job_id, status="complete",
                completed_at=datetime.now(timezone.utc).isoformat(),
                progress_pct=100)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/file")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: dict = _subscribed_user(),
):
    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large. Max {MAX_UPLOAD_BYTES // (1024*1024)}MB")

    if not data:
        raise HTTPException(400, "Empty file.")

    # Extract text chunks
    if ext in ("txt", "md"):
        text = extract_txt(data)
        chunks = chunks_from_long_text(text)
        source_label = "file_import_text"
    elif ext == "pdf":
        text = extract_pdf(data)
        chunks = chunks_from_long_text(text)
        source_label = "file_import_pdf"
    elif ext == "docx":
        text = extract_docx(data)
        chunks = chunks_from_long_text(text)
        source_label = "file_import_docx"
    elif ext == "json":
        chunks = extract_limitless_json(data)
        source_label = "file_import_json"
    elif ext == "zip":
        chunks = extract_limitless_zip(data)
        source_label = "file_import_zip"
    else:
        raise HTTPException(400, f"Unsupported file type: .{ext}. Accepted: .txt .md .pdf .docx .json .zip")

    if not chunks:
        raise HTTPException(422, "No readable content found in this file.")

    user_id = current_user["user_id"]
    job_id  = str(uuid.uuid4())
    now     = datetime.now(timezone.utc).isoformat()

    with driver.session() as s:
        s.run("""
            CREATE (j:ImportJob {
                job_id: $job_id, user_id: $user_id,
                filename: $filename, file_type: $ftype,
                status: 'processing', total: $total,
                processed: 0, imported: 0, failed: 0, progress_pct: 0,
                created_at: datetime($now)
            })
        """, job_id=job_id, user_id=user_id, filename=filename,
             ftype=ext, total=len(chunks), now=now)

    background_tasks.add_task(run_import, job_id, user_id, chunks, source_label)

    return {
        "job_id":   job_id,
        "filename": filename,
        "status":   "processing",
        "total":    len(chunks),
        "processed": 0,
        "imported":  0,
        "failed":    0,
        "progress_pct": 0,
    }


@router.get("/file/status/{job_id}")
async def get_file_status(job_id: str, current_user: dict = _subscribed_user()):
    with driver.session() as s:
        row = s.run(
            "MATCH (j:ImportJob {job_id: $job_id, user_id: $uid}) RETURN j",
            job_id=job_id, uid=current_user["user_id"]
        ).single()
    if not row:
        raise HTTPException(404, "Job not found.")
    j = dict(row["j"])
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in j.items()}


@router.get("/file/history")
async def get_file_history(current_user: dict = _subscribed_user()):
    uid = current_user["user_id"]
    with driver.session() as s:
        rows = s.run("""
            MATCH (j:ImportJob {user_id: $uid})
            RETURN j ORDER BY j.created_at DESC LIMIT 50
        """, uid=uid).data()
    imports = []
    for r in rows:
        j = dict(r["j"])
        imports.append({k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in j.items()})
    return {"imports": imports}


@router.delete("/file/{job_id}")
async def delete_file_import(job_id: str, current_user: dict = _subscribed_user()):
    uid = current_user["user_id"]
    with driver.session() as s:
        result = s.run("""
            MATCH (j:ImportJob {job_id: $job_id, user_id: $uid})
            OPTIONAL MATCH (e:Entry {import_job_id: $job_id, user_id: $uid})
            DETACH DELETE e, j
            RETURN count(e) AS deleted
        """, job_id=job_id, uid=uid).single()
    return {"entries_deleted": result["deleted"] if result else 0}


def register_file_import_routes(app):
    app.include_router(router)
