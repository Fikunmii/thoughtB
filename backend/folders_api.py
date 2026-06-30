"""
folders_api.py — Smart Folders for Thought Biography

Model:
  (:Folder {id, name, user_id, created_at, is_system_suggested, color})
  (:Entry)-[:IN_FOLDER]->(:Folder)              -- entry can belong to multiple folders
  (:FolderSuggestion {id, name, rationale, user_id, created_at, status, concept_labels})
  (:Entry)-[:SUGGESTED_FOR]->(:FolderSuggestion) -- supporting entries for a pending suggestion

Flow:
  On every new entry (called from api.py's create_entry, after extraction):
    1. Auto-assign to any existing folder whose concept signature overlaps
       enough with this entry's concepts (silent, no approval needed).
    2. If it didn't match an existing folder, look for other unfiled entries
       that cluster with it. If a cluster crosses the threshold, generate a
       Claude-named suggestion (or reuse/extend a pending one for the same
       cluster) for the user to approve.

  Folder creation ALWAYS requires explicit user approval via
  POST /folders/suggestions/{id}/accept — nothing is created silently.
"""
import os
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user

router = APIRouter(tags=["folders"])

# ── Tunables ─────────────────────────────────────────────────────────────────
AUTO_ASSIGN_MIN_SHARED   = 2     # min shared concepts with a folder's signature to auto-file
AUTO_ASSIGN_MIN_OVERLAP  = 0.25  # min Jaccard overlap with a folder's signature to auto-file
CLUSTER_MIN_SIZE         = 3     # min entries (including the new one) to propose a folder
CLUSTER_MIN_SHARED       = 2     # min shared concepts between entries to count as "clustered"


def _driver():
    """Import the shared driver from api.py to avoid duplicate connections."""
    from api import driver
    return driver


def _claude():
    from api import claude
    return claude


# ── Models ───────────────────────────────────────────────────────────────────
class CreateFolderRequest(BaseModel):
    name: str
    color: str | None = None


class RenameFolderRequest(BaseModel):
    name: str


class AcceptSuggestionRequest(BaseModel):
    name: str | None = None  # allow renaming on accept


class DismissSuggestionRequest(BaseModel):
    permanent: bool = False  # if true, suppress future suggestions for this concept cluster


# ── Core clustering logic (called from api.py after entry extraction) ────────
def process_entry_for_folders(user_id: str, entry_id: str, concept_labels: list[str]):
    """
    Called right after an entry's concepts are written to the graph.
    1. Try to auto-assign to an existing folder (silent).
    2. If unfiled, check whether it forms/extends a cluster worth suggesting.
    Never raises — folder logic should never break entry creation.
    """
    if not concept_labels:
        return
    try:
        driver = _driver()
        with driver.session() as s:
            assigned = _try_auto_assign(s, user_id, entry_id, concept_labels)
            if not assigned:
                _try_cluster_suggestion(s, user_id, entry_id, concept_labels)
    except Exception as e:
        import traceback
        print(f"[folders] non-fatal error processing entry {entry_id}: {e}")
        traceback.print_exc()


def _try_auto_assign(session, user_id: str, entry_id: str, concept_labels: list[str]) -> bool:
    """Compare entry concepts against each existing folder's concept signature.
    Auto-attach IN_FOLDER if overlap clears the threshold. Returns True if assigned."""
    folders = session.run("""
        MATCH (f:Folder {user_id: $uid})
        OPTIONAL MATCH (e:Entry)-[:IN_FOLDER]->(f)
        OPTIONAL MATCH (e)-[:SURFACES]->(c:Concept)
        WITH f, collect(DISTINCT c.label) AS signature
        RETURN f.id AS id, f.name AS name, signature
    """, uid=user_id).data()

    entry_set = set(concept_labels)
    best_folder = None
    best_overlap = 0.0
    best_shared = 0

    for f in folders:
        sig = set(x for x in (f["signature"] or []) if x)
        if not sig:
            continue
        shared = entry_set & sig
        if not shared:
            continue
        overlap = len(shared) / len(entry_set | sig)
        if overlap > best_overlap:
            best_overlap = overlap
            best_shared = len(shared)
            best_folder = f

    if best_folder and best_shared >= AUTO_ASSIGN_MIN_SHARED and best_overlap >= AUTO_ASSIGN_MIN_OVERLAP:
        session.run("""
            MATCH (e:Entry {id: $eid})
            MATCH (f:Folder {id: $fid})
            MERGE (e)-[:IN_FOLDER]->(f)
        """, eid=entry_id, fid=best_folder["id"])
        print(f"[folders] auto-assigned entry {entry_id} -> folder '{best_folder['name']}' "
              f"(shared={best_shared}, overlap={best_overlap:.2f})")
        return True
    return False


def _try_cluster_suggestion(session, user_id: str, entry_id: str, concept_labels: list[str]):
    """Find other unfiled, unsuggested-for entries that share concepts with this one.
    If the cluster is big enough, generate (or extend) a Claude-named suggestion."""

    # Entries not in any folder and not already part of a pending suggestion
    candidates = session.run("""
        MATCH (e:Entry {user_id: $uid})
        WHERE e.id <> $eid
          AND NOT (e)-[:IN_FOLDER]->(:Folder)
          AND NOT (e)-[:SUGGESTED_FOR]->(:FolderSuggestion {status: 'pending'})
        MATCH (e)-[:SURFACES]->(c:Concept)
        WITH e, collect(DISTINCT c.label) AS labels
        RETURN e.id AS id, e.created_at AS created_at, labels
    """, uid=user_id, eid=entry_id).data()

    entry_set = set(concept_labels)
    cluster_entry_ids = [entry_id]
    cluster_concepts = set(entry_set)

    for cand in candidates:
        cand_set = set(x for x in (cand["labels"] or []) if x)
        shared = entry_set & cand_set
        if len(shared) >= CLUSTER_MIN_SHARED:
            cluster_entry_ids.append(cand["id"])
            cluster_concepts |= cand_set

    if len(cluster_entry_ids) < CLUSTER_MIN_SIZE:
        return

    # Don't re-suggest a cluster that's already permanently dismissed
    fingerprint = _fingerprint(cluster_concepts & entry_set)  # core overlap signature
    dismissed = session.run("""
        MATCH (fs:FolderSuggestion {user_id: $uid, status: 'dismissed_permanent'})
        RETURN fs.concept_fingerprint AS fp
    """, uid=user_id).data()
    if any(_fingerprint_overlaps(fingerprint, d["fp"]) for d in dismissed if d["fp"]):
        print(f"[folders] cluster for entry {entry_id} matches a permanently dismissed suggestion, skipping")
        return

    # Is there already a pending suggestion covering most of this cluster? Extend it instead of duplicating.
    existing = session.run("""
        MATCH (fs:FolderSuggestion {user_id: $uid, status: 'pending'})<-[:SUGGESTED_FOR]-(e:Entry)
        WITH fs, collect(e.id) AS entry_ids
        RETURN fs.id AS id, entry_ids
    """, uid=user_id).data()

    for ex in existing:
        overlap = set(ex["entry_ids"]) & set(cluster_entry_ids)
        if len(overlap) >= max(2, CLUSTER_MIN_SIZE - 1):
            # extend existing suggestion with any new entries
            new_ids = [eid for eid in cluster_entry_ids if eid not in ex["entry_ids"]]
            for eid in new_ids:
                session.run("""
                    MATCH (e:Entry {id: $eid}), (fs:FolderSuggestion {id: $fsid})
                    MERGE (e)-[:SUGGESTED_FOR]->(fs)
                """, eid=eid, fsid=ex["id"])
            if new_ids:
                print(f"[folders] extended suggestion {ex['id']} with {len(new_ids)} new entries")
            return

    # Generate a fresh suggestion, named by Claude
    name, rationale = _generate_folder_name(session, cluster_entry_ids, cluster_concepts)
    suggestion_id = str(uuid.uuid4())
    session.run("""
        CREATE (fs:FolderSuggestion {
            id: $id, name: $name, rationale: $rationale,
            user_id: $uid, created_at: datetime(),
            status: 'pending', concept_fingerprint: $fp
        })
        WITH fs
        UNWIND $entry_ids AS eid
        MATCH (e:Entry {id: eid})
        MERGE (e)-[:SUGGESTED_FOR]->(fs)
    """, id=suggestion_id, name=name, rationale=rationale,
         uid=user_id, fp=fingerprint, entry_ids=cluster_entry_ids)
    print(f"[folders] new suggestion '{name}' ({len(cluster_entry_ids)} entries) for user {user_id}")


def _fingerprint(concepts: set[str]) -> str:
    return "|".join(sorted(c.lower() for c in concepts if c))


def _fingerprint_overlaps(fp_a: str, fp_b: str, threshold: float = 0.5) -> bool:
    a, b = set(fp_a.split("|")), set(fp_b.split("|"))
    if not a or not b:
        return False
    return len(a & b) / len(a | b) >= threshold


def _generate_folder_name(session, entry_ids: list[str], concepts: set[str]) -> tuple[str, str]:
    """Ask Claude to name the cluster based on the supporting entries. Falls back to a
    heuristic (top concept label) if the call fails for any reason."""
    rows = session.run("""
        MATCH (e:Entry) WHERE e.id IN $ids
        RETURN e.content AS content
        ORDER BY e.created_at DESC
        LIMIT 5
    """, ids=entry_ids).data()
    snippets = "\n\n---\n\n".join((r["content"] or "")[:600] for r in rows)

    try:
        client = _claude()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=200,
            system=(
                "You name thematic folders for a personal journaling app. Given journal "
                "excerpts that share a theme, respond ONLY with JSON: "
                '{"name": "Short Title Case Name (2-4 words)", "rationale": "one sentence on why these belong together"}. '
                "No markdown, no preamble."
            ),
            messages=[{"role": "user", "content": snippets}],
        )
        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        data = json.loads(text)
        name = data.get("name", "").strip()
        rationale = data.get("rationale", "").strip()
        if name:
            return name, rationale or f"{len(entry_ids)} entries share recurring themes."
    except Exception as e:
        print(f"[folders] Claude naming failed, falling back to heuristic: {e}")

    # Heuristic fallback: most common concept label, title-cased
    top = sorted(concepts)[0] if concepts else "Untitled"
    return top.title(), f"{len(entry_ids)} entries share the concept '{top}'."


# ── Endpoints ────────────────────────────────────────────────────────────────
@router.get("/folders")
def list_folders(current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with _driver().session() as s:
        rows = s.run("""
            MATCH (f:Folder {user_id: $uid})
            OPTIONAL MATCH (e:Entry)-[:IN_FOLDER]->(f)
            RETURN f.id AS id, f.name AS name, f.color AS color,
                   f.created_at AS created_at, count(e) AS entry_count
            ORDER BY f.created_at DESC
        """, uid=uid).data()
    return {"folders": [
        {**r, "created_at": _ser_dt(r["created_at"])} for r in rows
    ]}


@router.post("/folders")
def create_folder(req: CreateFolderRequest, current_user: dict = Depends(get_current_user)):
    """Manual folder creation, initiated directly by the user (not via suggestion)."""
    uid = current_user["user_id"]
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "Folder name is required")
    fid = str(uuid.uuid4())
    with _driver().session() as s:
        s.run("""
            CREATE (f:Folder {
                id: $id, name: $name, color: $color, user_id: $uid,
                created_at: datetime(), is_system_suggested: false
            })
        """, id=fid, name=name, color=req.color, uid=uid)
    return {"id": fid, "name": name}


@router.patch("/folders/{folder_id}")
def rename_folder(folder_id: str, req: RenameFolderRequest, current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "Folder name is required")
    with _driver().session() as s:
        r = s.run("""
            MATCH (f:Folder {id: $id, user_id: $uid})
            SET f.name = $name
            RETURN f.id AS id
        """, id=folder_id, uid=uid, name=name).single()
    if not r:
        raise HTTPException(404, "Folder not found")
    return {"id": folder_id, "name": name}


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str, current_user: dict = Depends(get_current_user)):
    """Deletes the folder. Entries are unfiled, not deleted."""
    uid = current_user["user_id"]
    with _driver().session() as s:
        r = s.run("""
            MATCH (f:Folder {id: $id, user_id: $uid})
            DETACH DELETE f
            RETURN $id AS id
        """, id=folder_id, uid=uid).single()
    if not r:
        raise HTTPException(404, "Folder not found")
    return {"deleted": folder_id}


@router.get("/folders/{folder_id}/entries")
def get_folder_entries(folder_id: str, current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with _driver().session() as s:
        folder = s.run("MATCH (f:Folder {id: $id, user_id: $uid}) RETURN f.name AS name",
                        id=folder_id, uid=uid).single()
        if not folder:
            raise HTTPException(404, "Folder not found")
        rows = s.run("""
            MATCH (e:Entry)-[:IN_FOLDER]->(f:Folder {id: $id, user_id: $uid})
            OPTIONAL MATCH (e)-[:SURFACES]->(c:Concept)
            WITH e, collect(c.label)[0..5] AS concepts
            RETURN e.id AS id, e.content AS content, e.created_at AS created_at,
                   e.emotional_tone AS emotional_tone, e.significance_score AS significance_score,
                   e.word_count AS word_count, concepts
            ORDER BY e.created_at DESC
        """, id=folder_id, uid=uid).data()
    entries = []
    for r in rows:
        entry = dict(r)
        entry["created_at"] = _ser_dt(entry.get("created_at"))
        entry["excerpt"] = (entry.get("content") or "")[:280]
        entries.append(entry)
    return {
        "folder": {"id": folder_id, "name": folder["name"]},
        "entries": entries,
    }


@router.post("/folders/{folder_id}/entries/{entry_id}")
def add_entry_to_folder(folder_id: str, entry_id: str, current_user: dict = Depends(get_current_user)):
    """Manual file/move — lets the user override the fluid auto-assignment."""
    uid = current_user["user_id"]
    with _driver().session() as s:
        r = s.run("""
            MATCH (e:Entry {id: $eid, user_id: $uid})
            MATCH (f:Folder {id: $fid, user_id: $uid})
            MERGE (e)-[:IN_FOLDER]->(f)
            RETURN e.id AS id
        """, eid=entry_id, uid=uid, fid=folder_id).single()
    if not r:
        raise HTTPException(404, "Entry or folder not found")
    return {"ok": True}


@router.delete("/folders/{folder_id}/entries/{entry_id}")
def remove_entry_from_folder(folder_id: str, entry_id: str, current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with _driver().session() as s:
        s.run("""
            MATCH (e:Entry {id: $eid, user_id: $uid})-[r:IN_FOLDER]->(f:Folder {id: $fid, user_id: $uid})
            DELETE r
        """, eid=entry_id, uid=uid, fid=folder_id)
    return {"ok": True}


@router.get("/folders/suggestions")
def list_suggestions(current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with _driver().session() as s:
        rows = s.run("""
            MATCH (fs:FolderSuggestion {user_id: $uid, status: 'pending'})
            OPTIONAL MATCH (e:Entry)-[:SUGGESTED_FOR]->(fs)
            RETURN fs.id AS id, fs.name AS name, fs.rationale AS rationale,
                   fs.created_at AS created_at, collect(e.id) AS entry_ids, count(e) AS entry_count
            ORDER BY fs.created_at DESC
        """, uid=uid).data()
    return {"suggestions": [{**r, "created_at": _ser_dt(r["created_at"])} for r in rows]}


@router.post("/folders/suggestions/{suggestion_id}/accept")
def accept_suggestion(suggestion_id: str, req: AcceptSuggestionRequest, current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    with _driver().session() as s:
        sugg = s.run("""
            MATCH (fs:FolderSuggestion {id: $id, user_id: $uid, status: 'pending'})
            OPTIONAL MATCH (e:Entry)-[:SUGGESTED_FOR]->(fs)
            RETURN fs.name AS name, collect(e.id) AS entry_ids
        """, id=suggestion_id, uid=uid).single()
        if not sugg:
            raise HTTPException(404, "Suggestion not found or already resolved")

        name = (req.name or sugg["name"]).strip()
        folder_id = str(uuid.uuid4())
        s.run("""
            CREATE (f:Folder {
                id: $fid, name: $name, user_id: $uid,
                created_at: datetime(), is_system_suggested: true
            })
            WITH f
            UNWIND $entry_ids AS eid
            MATCH (e:Entry {id: eid})
            MERGE (e)-[:IN_FOLDER]->(f)
            WITH f
            MATCH (fs:FolderSuggestion {id: $sid})
            SET fs.status = 'accepted'
        """, fid=folder_id, name=name, uid=uid, entry_ids=sugg["entry_ids"], sid=suggestion_id)

    return {"folder_id": folder_id, "name": name, "entry_count": len(sugg["entry_ids"])}


@router.post("/folders/suggestions/{suggestion_id}/dismiss")
def dismiss_suggestion(suggestion_id: str, req: DismissSuggestionRequest, current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
    status = "dismissed_permanent" if req.permanent else "dismissed"
    with _driver().session() as s:
        r = s.run("""
            MATCH (fs:FolderSuggestion {id: $id, user_id: $uid, status: 'pending'})
            SET fs.status = $status
            RETURN fs.id AS id
        """, id=suggestion_id, uid=uid, status=status).single()
    if not r:
        raise HTTPException(404, "Suggestion not found or already resolved")
    return {"dismissed": suggestion_id, "permanent": req.permanent}


def _ser_dt(val):
    if val is None:
        return None
    import re
    s = str(val)
    s = re.sub(r'(\.\d{3})\d+([+\-Z])', r'\1\2', s)
    s = re.sub(r'(\.\d{3})\d+$', r'\1', s)
    return s


def register_folder_routes(app):
    app.include_router(router)
