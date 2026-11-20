"""
file_import.py — Generic File Import for Thought Biography
Accepts: .pdf, .docx, .txt, .md, .json (Limitless), .zip
Each chunk runs through the full extract_with_claude + write_extraction_to_graph
pipeline — identical to typing a journal entry directly.
"""

import os, io, json, uuid, zipfile, logging
from datetime import datetime, timezone

import anthropic
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from neo4j import GraphDatabase

log = logging.getLogger("file_import")

NEO4J_URI      = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER     = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")
driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

router = APIRouter(prefix="/import", tags=["import"])
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MIN_WORDS = 20


# ── Auth ──────────────────────────────────────────────────────────────────────

def _current_user():
    from auth import get_current_user
    return Depends(get_current_user)

def _subscribed_user():
    from auth import require_subscription
    return Depends(require_subscription)


# ── Text extractors ───────────────────────────────────────────────────────────

def extract_txt(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")

def extract_pdf(data: bytes) -> str:
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(data))
        pages = [p.extract_text() or "" for p in reader.pages]
        return "\n\n".join(p.strip() for p in pages if p.strip())
    except ImportError:
        raise HTTPException(500, "pypdf not installed.")
    except Exception as e:
        raise HTTPException(422, f"Could not parse PDF: {e}")

def extract_docx(data: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(data))
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except ImportError:
        raise HTTPException(500, "python-docx not installed.")
    except Exception as e:
        raise HTTPException(422, f"Could not parse DOCX: {e}")

def _pull_text_from_limitless(obj) -> str:
    if isinstance(obj, str):
        return obj
    if isinstance(obj, dict):
        for key in ("transcript", "text", "content", "summary", "body"):
            if key in obj and isinstance(obj[key], str):
                return obj[key]
        for val in obj.values():
            if isinstance(val, (list, dict)):
                sub = _pull_text_from_limitless(val)
                if sub:
                    return sub
    if isinstance(obj, list):
        parts = [_pull_text_from_limitless(i) for i in obj if _pull_text_from_limitless(i)]
        return "\n\n".join(parts)
    return ""

def extract_limitless_json(data: bytes) -> list[str]:
    try:
        payload = json.loads(data)
    except Exception as e:
        raise HTTPException(422, f"Invalid JSON: {e}")
    chunks = []
    if isinstance(payload, list):
        for item in payload:
            text = _pull_text_from_limitless(item)
            if text and len(text.split()) >= MIN_WORDS:
                chunks.append(text)
    else:
        text = _pull_text_from_limitless(payload)
        if text and len(text.split()) >= MIN_WORDS:
            chunks.append(text)
    return chunks

def extract_limitless_zip(data: bytes) -> list[str]:
    chunks = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for name in zf.namelist():
                if name.endswith(".json"):
                    try:
                        chunks.extend(extract_limitless_json(zf.read(name)))
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


# ── Import job runner ─────────────────────────────────────────────────────────

def _update_job(job_id: str, **kwargs):
    with driver.session() as s:
        set_parts = ", ".join(f"j.{k} = ${k}" for k in kwargs)
        s.run(f"MATCH (j:ImportJob {{job_id: $job_id}}) SET {set_parts}",
              job_id=job_id, **kwargs)


def run_import(job_id: str, user_id: str, chunks: list[str], source_label: str):
    """
    Background task: processes each chunk through the full ingest pipeline.
    Uses extract_with_claude + write_extraction_to_graph from api.py so that
    every imported chunk produces the same graph structure as a typed journal entry:
    Concept nodes, SURFACES, REINFORCES, CONTRADICTS, Person, Source, LifeContext.
    """
    # Import from api at runtime to avoid circular import at module load
    from api import extract_with_claude, write_extraction_to_graph

    total = len(chunks)
    imported = 0
    failed = 0

    for i, text in enumerate(chunks):
        try:
            entry_id   = str(uuid.uuid4())
            created_at = datetime.now(timezone.utc).isoformat()

            # 1. Create the Entry node linked to the User
            with driver.session() as s:
                s.run("""
                    MATCH (u:User {id: $uid})
                    CREATE (e:Entry {
                        id:           $id,
                        content:      $content,
                        source:       $source,
                        created_at:   datetime($created_at),
                        user_id:      $uid,
                        import_job_id: $job_id,
                        is_indexed:   false,
                        word_count:   $wc
                    })
                    CREATE (e)-[:BELONGS_TO]->(u)
                """, uid=user_id, id=entry_id, content=text,
                     source=source_label, created_at=created_at,
                     job_id=job_id, wc=len(text.split()))

            # 2. Full Claude extraction
            extraction = extract_with_claude(text)

            # 3. Write all graph relationships (concepts, REINFORCES, CONTRADICTS,
            #    Person, Source, LifeContext) — identical to the journal entry pipeline
            write_extraction_to_graph(user_id, entry_id, extraction)

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

    if ext in ("txt", "md"):
        chunks = chunks_from_long_text(extract_txt(data))
        source_label = "file_import_text"
    elif ext == "pdf":
        chunks = chunks_from_long_text(extract_pdf(data))
        source_label = "file_import_pdf"
    elif ext == "docx":
        chunks = chunks_from_long_text(extract_docx(data))
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
                job_id: $job_id, user_id: $uid,
                filename: $filename, file_type: $ftype,
                status: 'processing', total: $total,
                processed: 0, imported: 0, failed: 0, progress_pct: 0,
                created_at: datetime($now)
            })
        """, job_id=job_id, uid=user_id, filename=filename,
             ftype=ext, total=len(chunks), now=now)

    background_tasks.add_task(run_import, job_id, user_id, chunks, source_label)

    return {
        "job_id": job_id, "filename": filename, "status": "processing",
        "total": len(chunks), "processed": 0, "imported": 0,
        "failed": 0, "progress_pct": 0,
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
