"""
team_api.py — Team/Org plan for ThoughtB
=========================================

Neo4j data model
-----------------
(:Workspace {id, name, slug, created_at, owner_id, plan})
  -[:HAS_MEMBER {role, joined_at}]-> (:User)
  -[:HAS_DECISION {created_at}]-> (:Decision {id, title, rationale, ...})

(:Entry) -[:PUBLISHED_TO_TEAM {at}]-> (:Workspace)

Roles: "owner" | "admin" | "member"

Routes
------
POST   /teams                           — create workspace
GET    /teams/me                        — list workspaces I belong to
GET    /teams/{workspace_id}            — workspace detail + members
POST   /teams/{workspace_id}/invite     — invite by email (sends link)
POST   /teams/{workspace_id}/join       — accept invite token
DELETE /teams/{workspace_id}/members/{user_id} — remove member (admin+)
PUT    /teams/{workspace_id}/members/{user_id}/role — change role (owner only)
DELETE /teams/{workspace_id}           — delete workspace (owner only)

GET    /teams/{workspace_id}/graph      — shared org graph (published entries only)
GET    /teams/{workspace_id}/decisions  — decision feed
GET    /teams/{workspace_id}/tensions   — cross-member tensions
GET    /teams/{workspace_id}/brief      — onboarding brief (Claude-generated PDF)
POST   /teams/{workspace_id}/brief      — trigger brief regeneration

POST   /entries/{entry_id}/publish      — publish entry to workspace
DELETE /entries/{entry_id}/publish      — unpublish

POST   /github/webhook                  — GitHub PR webhook → auto-ADR
"""

import os
import uuid
import json
import secrets
import hashlib
import smtplib
from datetime import datetime, timezone
from email.mime.text import MIMEText

import anthropic
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request, Header
from pydantic import BaseModel

from auth import get_current_user, require_subscription, driver
from api import serialize_dt

router = APIRouter()
claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://tbfrontend.netlify.app")


# ── helpers ──────────────────────────────────────────────────────────────────

def _require_member(workspace_id: str, user_id: str, min_role: str = "member") -> dict:
    """Return membership record or raise 403. min_role: member < admin < owner."""
    rank = {"member": 0, "admin": 1, "owner": 2}
    with driver.session() as s:
        r = s.run("""
            MATCH (w:Workspace {id: $wid})-[m:HAS_MEMBER]->(u:User {id: $uid})
            RETURN m.role AS role, w.owner_id AS owner_id, w.name AS name,
                   w.plan AS plan, w.id AS id
        """, wid=workspace_id, uid=user_id).single()
    if not r:
        raise HTTPException(403, "Not a member of this workspace")
    if rank.get(r["role"], 0) < rank.get(min_role, 0):
        raise HTTPException(403, f"Requires {min_role} role")
    return dict(r)


def _send_invite_email(to_email: str, inviter_name: str, workspace_name: str, token: str):
    """Fire-and-forget invite email. Fails silently if SMTP not configured."""
    try:
        link = f"{FRONTEND_URL}/join-team?token={token}"
        body = (
            f"Hi,\n\n"
            f"{inviter_name} has invited you to join the '{workspace_name}' "
            f"workspace on ThoughtB.\n\n"
            f"Accept invite:\n{link}\n\n"
            f"This link expires in 7 days.\n\n"
            f"— ThoughtB"
        )
        msg = MIMEText(body)
        msg["Subject"] = f"{inviter_name} invited you to {workspace_name} on ThoughtB"
        msg["From"] = os.getenv("EMAIL_FROM", "noreply@thoughtbiography.site")
        msg["To"] = to_email

        with smtplib.SMTP(os.getenv("SMTP_HOST", ""), int(os.getenv("SMTP_PORT", 587))) as smtp:
            smtp.starttls()
            smtp.login(os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASSWORD", ""))
            smtp.send_message(msg)
    except Exception:
        pass  # email is best-effort; the token is returned to the caller too


# ── request models ────────────────────────────────────────────────────────────

class CreateWorkspaceRequest(BaseModel):
    name: str
    slug: str | None = None  # auto-derived from name if omitted

class InviteRequest(BaseModel):
    email: str

class ChangeRoleRequest(BaseModel):
    role: str  # "member" | "admin"


# ── workspace CRUD ────────────────────────────────────────────────────────────

@router.post("/teams")
def create_workspace(
    req: CreateWorkspaceRequest,
    current_user: dict = Depends(require_subscription),
):
    user_id = current_user["user_id"]
    wid = str(uuid.uuid4())
    slug = (req.slug or req.name.lower().replace(" ", "-"))[:40]
    slug = "".join(c for c in slug if c.isalnum() or c == "-")

    with driver.session() as s:
        # Enforce unique slug
        exists = s.run("MATCH (w:Workspace {slug: $slug}) RETURN w LIMIT 1", slug=slug).single()
        if exists:
            slug = f"{slug}-{wid[:4]}"

        s.run("""
            MATCH (u:User {id: $uid})
            CREATE (w:Workspace {
                id:         $wid,
                name:       $name,
                slug:       $slug,
                created_at: datetime(),
                owner_id:   $uid,
                plan:       'team'
            })
            CREATE (w)-[:HAS_MEMBER {role: 'owner', joined_at: datetime()}]->(u)
        """, uid=user_id, wid=wid, name=req.name, slug=slug)

    return {"id": wid, "name": req.name, "slug": slug, "role": "owner"}


@router.get("/teams/me")
def list_my_workspaces(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    with driver.session() as s:
        rows = s.run("""
            MATCH (w:Workspace)-[m:HAS_MEMBER]->(u:User {id: $uid})
            RETURN w.id AS id, w.name AS name, w.slug AS slug,
                   w.owner_id AS owner_id, m.role AS role,
                   serialize_dt(w.created_at) AS created_at
        """, uid=user_id).data()
    # serialize_dt not available in Cypher — fix inline
    with driver.session() as s:
        rows = s.run("""
            MATCH (w:Workspace)-[m:HAS_MEMBER]->(u:User {id: $uid})
            RETURN w.id AS id, w.name AS name, w.slug AS slug,
                   w.owner_id AS owner_id, m.role AS role,
                   toString(w.created_at) AS created_at
        """, uid=user_id).data()
    for r in rows:
        r["created_at"] = serialize_dt(r.get("created_at"))
    return rows


@router.get("/teams/{workspace_id}")
def get_workspace(workspace_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    mem = _require_member(workspace_id, user_id)

    with driver.session() as s:
        members = s.run("""
            MATCH (w:Workspace {id: $wid})-[m:HAS_MEMBER]->(u:User)
            RETURN u.id AS id, u.display_name AS display_name,
                   u.email AS email, m.role AS role,
                   toString(m.joined_at) AS joined_at
        """, wid=workspace_id).data()
        for m in members:
            m["joined_at"] = serialize_dt(m.get("joined_at"))

        stats = s.run("""
            MATCH (w:Workspace {id: $wid})-[m:HAS_MEMBER]->(u:User)
            WITH w, count(u) AS member_count
            OPTIONAL MATCH (e:Entry)-[:PUBLISHED_TO_TEAM]->(w)
            OPTIONAL MATCH ()-[:HAS_DECISION]->(d:Decision {workspace_id: $wid})
            RETURN member_count,
                   count(DISTINCT e) AS published_entries,
                   count(DISTINCT d) AS decisions
        """, wid=workspace_id).single()

    return {
        "id": workspace_id,
        "name": mem["name"],
        "role": mem["role"],
        "members": members,
        "stats": dict(stats) if stats else {},
    }


@router.delete("/teams/{workspace_id}")
def delete_workspace(workspace_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id, min_role="owner")
    with driver.session() as s:
        s.run("""
            MATCH (w:Workspace {id: $wid})
            OPTIONAL MATCH (w)-[r]-()
            DELETE r, w
        """, wid=workspace_id)
    return {"ok": True}


# ── invite / join ─────────────────────────────────────────────────────────────

@router.post("/teams/{workspace_id}/invite")
def invite_member(
    workspace_id: str,
    req: InviteRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    mem = _require_member(workspace_id, user_id, min_role="admin")

    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc).timestamp() + 7 * 86400  # 7 days

    with driver.session() as s:
        # Fetch inviter name
        inviter = s.run(
            "MATCH (u:User {id: $uid}) RETURN u.display_name AS name",
            uid=user_id
        ).single()
        inviter_name = inviter["name"] if inviter else "Someone"

        # Store invite
        s.run("""
            MERGE (i:TeamInvite {email: $email, workspace_id: $wid})
            SET i.token_hash = $hash,
                i.expires_at  = $exp,
                i.invited_by  = $uid,
                i.created_at  = datetime()
        """, email=req.email, wid=workspace_id, hash=token_hash,
             exp=expires_at, uid=user_id)

    background_tasks.add_task(
        _send_invite_email, req.email, inviter_name, mem["name"], token
    )
    return {"ok": True, "invite_token": token, "expires_in_days": 7}


@router.post("/teams/{workspace_id}/join")
def join_workspace(workspace_id: str, token: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now_ts = datetime.now(timezone.utc).timestamp()

    with driver.session() as s:
        invite = s.run("""
            MATCH (i:TeamInvite {workspace_id: $wid, token_hash: $hash})
            WHERE i.expires_at > $now
            RETURN i.email AS email
        """, wid=workspace_id, hash=token_hash, now=now_ts).single()

        if not invite:
            raise HTTPException(400, "Invalid or expired invite token")

        # Check user email matches invite
        user = s.run("MATCH (u:User {id: $uid}) RETURN u.email AS email", uid=user_id).single()
        if not user or user["email"] != invite["email"]:
            raise HTTPException(403, "This invite was sent to a different email address")

        # Already a member?
        existing = s.run("""
            MATCH (w:Workspace {id: $wid})-[m:HAS_MEMBER]->(u:User {id: $uid})
            RETURN m
        """, wid=workspace_id, uid=user_id).single()
        if existing:
            return {"ok": True, "message": "Already a member"}

        s.run("""
            MATCH (w:Workspace {id: $wid}), (u:User {id: $uid})
            CREATE (w)-[:HAS_MEMBER {role: 'member', joined_at: datetime()}]->(u)
        """, wid=workspace_id, uid=user_id)

        # Consume invite
        s.run("MATCH (i:TeamInvite {workspace_id: $wid, token_hash: $hash}) DELETE i",
              wid=workspace_id, hash=token_hash)

    return {"ok": True, "workspace_id": workspace_id}


# ── member management ─────────────────────────────────────────────────────────

@router.delete("/teams/{workspace_id}/members/{target_user_id}")
def remove_member(
    workspace_id: str,
    target_user_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    mem = _require_member(workspace_id, user_id, min_role="admin")

    # Owners can't be removed except by themselves
    if target_user_id != user_id and mem["owner_id"] == target_user_id:
        raise HTTPException(403, "Cannot remove the workspace owner")

    with driver.session() as s:
        s.run("""
            MATCH (w:Workspace {id: $wid})-[m:HAS_MEMBER]->(u:User {id: $uid})
            DELETE m
        """, wid=workspace_id, uid=target_user_id)

    return {"ok": True}


@router.put("/teams/{workspace_id}/members/{target_user_id}/role")
def change_member_role(
    workspace_id: str,
    target_user_id: str,
    req: ChangeRoleRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id, min_role="owner")

    if req.role not in ("member", "admin"):
        raise HTTPException(400, "Role must be 'member' or 'admin'")

    with driver.session() as s:
        s.run("""
            MATCH (w:Workspace {id: $wid})-[m:HAS_MEMBER]->(u:User {id: $uid})
            SET m.role = $role
        """, wid=workspace_id, uid=target_user_id, role=req.role)

    return {"ok": True}


# ── publish / unpublish entries ───────────────────────────────────────────────

@router.post("/entries/{entry_id}/publish")
def publish_entry(
    entry_id: str,
    workspace_id: str,
    current_user: dict = Depends(require_subscription),
):
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id)

    with driver.session() as s:
        # Verify entry belongs to user
        entry = s.run("""
            MATCH (e:Entry {id: $eid, user_id: $uid}) RETURN e.id AS id
        """, eid=entry_id, uid=user_id).single()
        if not entry:
            raise HTTPException(404, "Entry not found")

        s.run("""
            MATCH (e:Entry {id: $eid}), (w:Workspace {id: $wid})
            MERGE (e)-[r:PUBLISHED_TO_TEAM]->(w)
            SET r.at = datetime()
        """, eid=entry_id, wid=workspace_id)

    return {"ok": True}


@router.delete("/entries/{entry_id}/publish")
def unpublish_entry(
    entry_id: str,
    workspace_id: str,
    current_user: dict = Depends(require_subscription),
):
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id)

    with driver.session() as s:
        s.run("""
            MATCH (e:Entry {id: $eid, user_id: $uid})-[r:PUBLISHED_TO_TEAM]->(w:Workspace {id: $wid})
            DELETE r
        """, eid=entry_id, uid=user_id, wid=workspace_id)

    return {"ok": True}


# ── shared org graph ──────────────────────────────────────────────────────────

@router.get("/teams/{workspace_id}/graph")
def team_graph(workspace_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id)

    with driver.session() as s:
        # Concepts surfaced by published entries, with contributing author info
        nodes_raw = s.run("""
            MATCH (e:Entry)-[:PUBLISHED_TO_TEAM]->(w:Workspace {id: $wid})
            MATCH (e)-[:SURFACES]->(c:Concept)
            MATCH (u:User {id: e.user_id})
            WITH c, collect(DISTINCT u.display_name) AS authors,
                 count(DISTINCT e) AS entry_count
            RETURN c.label AS label,
                   c.description AS description,
                   entry_count,
                   authors
        """, wid=workspace_id).data()

        edges_raw = s.run("""
            MATCH (e:Entry)-[:PUBLISHED_TO_TEAM]->(w:Workspace {id: $wid})
            MATCH (e)-[:SURFACES]->(c1:Concept)
            MATCH (e)-[:SURFACES]->(c2:Concept)
            WHERE id(c1) < id(c2)
            WITH c1, c2, count(DISTINCT e) AS weight
            RETURN c1.label AS source, c2.label AS target, weight
            ORDER BY weight DESC LIMIT 300
        """, wid=workspace_id).data()

        # Cross-member concept overlap (2+ different authors on same concept)
        overlaps = s.run("""
            MATCH (e:Entry)-[:PUBLISHED_TO_TEAM]->(w:Workspace {id: $wid})
            MATCH (e)-[:SURFACES]->(c:Concept)
            WITH c, count(DISTINCT e.user_id) AS author_count
            WHERE author_count >= 2
            RETURN c.label AS label, author_count
            ORDER BY author_count DESC LIMIT 20
        """, wid=workspace_id).data()

    return {
        "nodes":    nodes_raw,
        "edges":    edges_raw,
        "overlaps": overlaps,
    }


# ── cross-member tensions ─────────────────────────────────────────────────────

@router.get("/teams/{workspace_id}/tensions")
def team_tensions(workspace_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id)

    with driver.session() as s:
        rows = s.run("""
            MATCH (e1:Entry)-[:PUBLISHED_TO_TEAM]->(w:Workspace {id: $wid})
            MATCH (e2:Entry)-[:PUBLISHED_TO_TEAM]->(w)
            WHERE e1.user_id <> e2.user_id
            MATCH (e1)-[:SURFACES]->(c:Concept)<-[:SURFACES]-(e2)
            MATCH (e1)-[r:CONTRADICTS]-(e2)
            WHERE NOT exists(r.resolved)
            WITH c.label   AS concept,
                 e1.user_id AS user_a,
                 e2.user_id AS user_b,
                 e1.id      AS entry_a,
                 e2.id      AS entry_b,
                 toString(e1.created_at) AS date_a,
                 toString(e2.created_at) AS date_b
            RETURN concept, user_a, user_b, entry_a, entry_b, date_a, date_b
            LIMIT 50
        """, wid=workspace_id).data()

        # Enrich with display names
        uid_set = {r["user_a"] for r in rows} | {r["user_b"] for r in rows}
        name_map = {}
        if uid_set:
            names = s.run("""
                MATCH (u:User) WHERE u.id IN $ids
                RETURN u.id AS id, u.display_name AS name
            """, ids=list(uid_set)).data()
            name_map = {n["id"]: n["name"] for n in names}

    for r in rows:
        r["user_a_name"] = name_map.get(r["user_a"], "Unknown")
        r["user_b_name"] = name_map.get(r["user_b"], "Unknown")
        r["date_a"] = serialize_dt(r.get("date_a"))
        r["date_b"] = serialize_dt(r.get("date_b"))

    return rows


# ── decision feed (Auto-ADR) ──────────────────────────────────────────────────

@router.get("/teams/{workspace_id}/decisions")
def team_decisions(workspace_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id)

    with driver.session() as s:
        rows = s.run("""
            MATCH (w:Workspace {id: $wid})-[:HAS_DECISION]->(d:Decision)
            RETURN d.id          AS id,
                   d.title       AS title,
                   d.rationale   AS rationale,
                   d.alternatives_considered AS alternatives,
                   d.outcome     AS outcome,
                   d.source      AS source,
                   d.source_url  AS source_url,
                   d.author_name AS author_name,
                   toString(d.created_at) AS created_at
            ORDER BY d.created_at DESC
        """, wid=workspace_id).data()

    for r in rows:
        r["created_at"] = serialize_dt(r.get("created_at"))

    return rows


# ── GitHub webhook → Auto-ADR ─────────────────────────────────────────────────

@router.post("/github/webhook")
async def github_webhook(
    request: Request,
    x_hub_signature_256: str = Header(default=None),
    x_github_event: str = Header(default=None),
):
    """Receives GitHub PR events and creates Decision nodes (Auto-ADR)."""
    import hmac, hashlib

    body = await request.body()

    # Verify signature if secret is configured
    secret = os.getenv("GITHUB_WEBHOOK_SECRET", "")
    if secret:
        expected = "sha256=" + hmac.new(
            secret.encode(), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, x_hub_signature_256 or ""):
            raise HTTPException(401, "Invalid webhook signature")

    if x_github_event != "pull_request":
        return {"ok": True, "skipped": True}

    payload = json.loads(body)
    action = payload.get("action")
    pr = payload.get("pull_request", {})

    if action != "closed" or not pr.get("merged"):
        return {"ok": True, "skipped": True}

    repo_name = payload.get("repository", {}).get("full_name", "")
    pr_title  = pr.get("title", "")
    pr_body   = pr.get("body") or ""
    pr_url    = pr.get("html_url", "")
    author    = pr.get("merged_by", {}).get("login", "unknown")
    files_changed = pr.get("changed_files", 0)

    # Find workspace linked to this repo
    with driver.session() as s:
        ws = s.run("""
            MATCH (w:Workspace {github_repo: $repo}) RETURN w.id AS id, w.name AS name
        """, repo=repo_name).single()

    if not ws:
        # No workspace linked — skip silently
        return {"ok": True, "skipped": True, "reason": "no workspace linked to repo"}

    workspace_id = ws["id"]

    # Generate ADR via Claude
    prompt = f"""You are a technical decision analyst. A pull request was merged.
Extract a structured Architecture Decision Record (ADR) from this PR.

Repository: {repo_name}
PR Title: {pr_title}
PR Description:
{pr_body[:2000]}
Files changed: {files_changed}
Author: {author}

Return ONLY valid JSON with these fields:
{{
  "title": "concise decision title (max 80 chars)",
  "rationale": "why this decision was made (2-3 sentences)",
  "alternatives_considered": "what other approaches were considered or implied (1-2 sentences, or 'Not stated' if unclear)",
  "outcome": "what changed and expected impact (1-2 sentences)"
}}"""

    try:
        msg = claude.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = msg.content[0].text.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        adr = json.loads(raw)
    except Exception as e:
        adr = {
            "title": pr_title,
            "rationale": pr_body[:300] or "No description provided.",
            "alternatives_considered": "Not stated",
            "outcome": f"{files_changed} files changed.",
        }

    did = str(uuid.uuid4())
    with driver.session() as s:
        s.run("""
            MATCH (w:Workspace {id: $wid})
            CREATE (d:Decision {
                id:                      $did,
                workspace_id:            $wid,
                title:                   $title,
                rationale:               $rationale,
                alternatives_considered: $alts,
                outcome:                 $outcome,
                source:                  'github_pr',
                source_url:              $url,
                author_name:             $author,
                created_at:              datetime()
            })
            CREATE (w)-[:HAS_DECISION {created_at: datetime()}]->(d)
        """, wid=workspace_id, did=did, title=adr.get("title", pr_title),
             rationale=adr.get("rationale", ""), alts=adr.get("alternatives_considered", ""),
             outcome=adr.get("outcome", ""), url=pr_url, author=author)

    return {"ok": True, "decision_id": did}


# ── link GitHub repo to workspace ─────────────────────────────────────────────

@router.put("/teams/{workspace_id}/github")
def link_github_repo(
    workspace_id: str,
    repo: str,
    current_user: dict = Depends(get_current_user),
):
    """Link a GitHub repo (org/repo) to this workspace for Auto-ADR."""
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id, min_role="admin")

    with driver.session() as s:
        s.run("""
            MATCH (w:Workspace {id: $wid})
            SET w.github_repo = $repo
        """, wid=workspace_id, repo=repo)

    return {"ok": True, "github_repo": repo}


# ── onboarding brief ──────────────────────────────────────────────────────────

@router.get("/teams/{workspace_id}/brief")
def get_brief(workspace_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id)

    with driver.session() as s:
        brief = s.run("""
            MATCH (w:Workspace {id: $wid})
            RETURN w.brief_text AS text, toString(w.brief_generated_at) AS generated_at
        """, wid=workspace_id).single()

    if not brief or not brief["text"]:
        return {"text": None, "generated_at": None}

    return {"text": brief["text"], "generated_at": serialize_dt(brief.get("generated_at"))}


@router.post("/teams/{workspace_id}/brief")
def generate_brief(workspace_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id, min_role="admin")

    with driver.session() as s:
        # Top concepts in team graph
        concepts = s.run("""
            MATCH (e:Entry)-[:PUBLISHED_TO_TEAM]->(w:Workspace {id: $wid})
            MATCH (e)-[:SURFACES]->(c:Concept)
            WITH c.label AS label, count(DISTINCT e) AS cnt
            ORDER BY cnt DESC LIMIT 8
            RETURN collect(label) AS labels
        """, wid=workspace_id).single()

        # Recent decisions
        decisions = s.run("""
            MATCH (w:Workspace {id: $wid})-[:HAS_DECISION]->(d:Decision)
            RETURN d.title AS title, d.rationale AS rationale
            ORDER BY d.created_at DESC LIMIT 3
        """, wid=workspace_id).data()

        # Member count + name
        ws_info = s.run("""
            MATCH (w:Workspace {id: $wid})-[:HAS_MEMBER]->(u:User)
            RETURN w.name AS name, count(u) AS members
        """, wid=workspace_id).single()

    concept_list  = concepts["labels"] if concepts else []
    decision_list = [f"- {d['title']}: {d['rationale']}" for d in decisions]
    ws_name   = ws_info["name"]    if ws_info else "this team"
    ws_members = ws_info["members"] if ws_info else 0

    prompt = f"""You are writing a 2-page onboarding brief for a new member joining the '{ws_name}' team on ThoughtB.

Team size: {ws_members} members
Top concepts the team thinks about: {', '.join(concept_list) or 'not yet established'}

Recent decisions:
{chr(10).join(decision_list) or '- No decisions logged yet'}

Write a warm, clear onboarding brief with these sections:
1. **What this team thinks about** (based on the top concepts — explain the themes in plain language)
2. **Recent key decisions** (summarize the decisions above in context)
3. **How to contribute** (encourage publishing entries to the team graph, what kinds of thoughts are valuable here)

Be specific, not generic. Keep total length under 400 words. Use markdown formatting."""

    msg = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=700,
        messages=[{"role": "user", "content": prompt}]
    )
    brief_text = msg.content[0].text.strip()

    with driver.session() as s:
        s.run("""
            MATCH (w:Workspace {id: $wid})
            SET w.brief_text = $text, w.brief_generated_at = datetime()
        """, wid=workspace_id, text=brief_text)

    return {"text": brief_text}


# ── registration helper ───────────────────────────────────────────────────────

def register_team_routes(app):
    app.include_router(router, tags=["teams"])


# ── "Ask the Org" — team-scoped RAG chat ─────────────────────────────────────

import re
from typing import List
from fastapi.responses import StreamingResponse

TEAM_CHAT_MODEL = "claude-sonnet-4-6"
TEAM_MAX_ENTRIES = 6

TEAM_SYSTEM_PROMPT = """You are the ThoughtB Org assistant — an AI that helps team members explore their collective knowledge graph.

Rules:
1. Ground every claim in the provided excerpts from published team entries and decision records.
2. Cite inline as [Entry · Author · YYYY-MM-DD] for journal entries, or [Decision · Author · YYYY-MM-DD] for ADRs.
3. If the excerpts don't contain the answer, say so plainly — do not invent team history or decisions.
4. Surface patterns across team members: where thinking overlaps, where it diverges.
5. Be direct and useful. 2-5 paragraphs unless asked for depth."""


def _esc_lucene(q: str) -> str:
    return re.sub(r'[+\-&|!(){}\[\]^"~*?:\\/]', r'\\\g<0>', q)


def _clip(text: str, n: int) -> str:
    return text[:n] + "…" if len(text) > n else text


def retrieve_team_context(workspace_id: str, question: str) -> dict:
    """FTS over published entries + decision feed, scoped to workspace."""
    q = _esc_lucene(question.strip())
    excerpts: List[dict] = []
    decisions: List[dict] = []

    with driver.session() as s:
        # FTS over published entries
        try:
            res = s.run("""
                CALL db.index.fulltext.queryNodes('entry_content', $q) YIELD node, score
                WHERE EXISTS {
                    MATCH (node)-[:PUBLISHED_TO_TEAM]->(w:Workspace {id: $wid})
                }
                RETURN node.id AS id, node.content AS content,
                       node.user_id AS user_id, node.created_at AS created_at, score
                ORDER BY score DESC LIMIT $limit
            """, q=q, wid=workspace_id, limit=TEAM_MAX_ENTRIES)
            for r in res:
                excerpts.append({
                    "id":      r["id"],
                    "user_id": r["user_id"],
                    "date":    (str(r["created_at"] or ""))[:10] or "undated",
                    "text":    _clip(r["content"] or "", 1000),
                })
        except Exception:
            pass

        # Cold start — most recent published entries
        if not excerpts:
            res = s.run("""
                MATCH (e:Entry)-[:PUBLISHED_TO_TEAM]->(w:Workspace {id: $wid})
                RETURN e.id AS id, e.content AS content,
                       e.user_id AS user_id, e.created_at AS created_at
                ORDER BY e.created_at DESC LIMIT 4
            """, wid=workspace_id)
            for r in res:
                excerpts.append({
                    "id":      r["id"],
                    "user_id": r["user_id"],
                    "date":    (str(r["created_at"] or ""))[:10] or "undated",
                    "text":    _clip(r["content"] or "", 1000),
                })

        # Enrich with author names
        uid_set = list({e["user_id"] for e in excerpts if e.get("user_id")})
        name_map = {}
        if uid_set:
            names = s.run("""
                MATCH (u:User) WHERE u.id IN $ids
                RETURN u.id AS id, u.display_name AS name
            """, ids=uid_set).data()
            name_map = {n["id"]: n["name"] for n in names}
        for e in excerpts:
            e["author"] = name_map.get(e["user_id"], "Team member")

        # Most recent decisions
        decisions_raw = s.run("""
            MATCH (w:Workspace {id: $wid})-[:HAS_DECISION]->(d:Decision)
            RETURN d.id AS id, d.title AS title, d.rationale AS rationale,
                   d.outcome AS outcome, d.author_name AS author,
                   toString(d.created_at) AS created_at
            ORDER BY d.created_at DESC LIMIT 4
        """, wid=workspace_id).data()
        for d in decisions_raw:
            decisions.append({
                "id":      d["id"],
                "title":   d["title"],
                "text":    f"{d['rationale']} Outcome: {d['outcome']}",
                "author":  d["author"] or "Unknown",
                "date":    (d["created_at"] or "")[:10] or "undated",
            })

    return {"excerpts": excerpts, "decisions": decisions}


def _build_team_context_block(ctx: dict) -> str:
    parts = []
    for i, e in enumerate(ctx["excerpts"], 1):
        parts.append(f"[Entry {i} · {e['author']} · {e['date']}]\n{e['text']}")
    for d in ctx["decisions"]:
        parts.append(f"[Decision · {d['author']} · {d['date']}]\nTitle: {d['title']}\n{d['text']}")
    return "\n\n---\n\n".join(parts) or "(no team entries or decisions found yet)"


class TeamChatIn(BaseModel):
    content: str


@router.post("/teams/{workspace_id}/chat")
def team_chat(
    workspace_id: str,
    body: TeamChatIn,
    current_user: dict = Depends(require_subscription),
):
    """Stream a response grounded in the team's published entries and decisions."""
    user_id = current_user["user_id"]
    _require_member(workspace_id, user_id)

    question = body.content.strip()
    if not question:
        raise HTTPException(400, "Message is empty")

    ctx = retrieve_team_context(workspace_id, question)

    def generate():
        try:
            with claude.messages.stream(
                model=TEAM_CHAT_MODEL,
                max_tokens=1024,
                system=f"{TEAM_SYSTEM_PROMPT}\n\nTeam knowledge base:\n{_build_team_context_block(ctx)}",
                messages=[{"role": "user", "content": question}],
            ) as stream:
                for chunk in stream.text_stream:
                    yield chunk
        except Exception as e:
            yield f"\n\n[error] {e}"

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")
