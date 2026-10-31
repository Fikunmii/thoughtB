"""
email_inbound.py — Postmark inbound email capture for ThoughtB

Flow:
  1. User's personal address (e.g. fikun-a3f9@in.thoughtbiography.site) receives an email
  2. Postmark POSTs parsed JSON to POST /email/inbound
  3. We verify the sender matches the owner, strip quoted replies, extract people/sources
  4. Run through the normal create_entry pipeline
  5. Send a brief confirmation reply via Postmark

Env vars required:
  POSTMARK_SERVER_TOKEN  — from Postmark dashboard (for sending confirmation replies)
  POSTMARK_INBOUND_TOKEN — from Postmark (used to verify webhook if you enable signature)
  EMAIL_FROM_DOMAIN      — e.g. "in.thoughtbiography.site"
"""

import os
import re
import uuid
import json
import hashlib
import logging
import requests
from datetime import datetime
from email.utils import parseaddr, getaddresses

from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from neo4j import GraphDatabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/email", tags=["email"])

# ── Config ────────────────────────────────────────────────────────────────────
POSTMARK_TOKEN   = os.getenv("POSTMARK_SERVER_TOKEN", "")
EMAIL_DOMAIN     = os.getenv("EMAIL_FROM_DOMAIN", "in.thoughtbiography.site")
CONFIRM_FROM     = os.getenv("POSTMARK_FROM_ADDRESS", f"journal@{EMAIL_DOMAIN}")

# ── Neo4j driver (shared from api.py) ─────────────────────────────────────────
# Imported at registration time to avoid circular imports
_driver = None
_extract_fn = None
_write_fn = None
_posthog = None


# ── Address generation ────────────────────────────────────────────────────────

def generate_inbound_address(user_id: str, display_name: str) -> str:
    """Generate a stable personal inbound address for a user."""
    slug_base = re.sub(r"[^a-z0-9]", "", display_name.lower())[:10] or "user"
    # 4-char hex derived from user_id for uniqueness (stable, not random)
    suffix = hashlib.md5(user_id.encode()).hexdigest()[:4]
    return f"{slug_base}-{suffix}@{EMAIL_DOMAIN}"


def ensure_user_inbound_address(user_id: str, display_name: str) -> str:
    """Get or create the inbound email address for a user node in Neo4j."""
    with _driver.session() as s:
        r = s.run(
            "MATCH (u:User {id: $uid}) RETURN u.inbound_email AS addr",
            uid=user_id,
        ).single()
        if r and r["addr"]:
            return r["addr"]
        # Generate and store
        addr = generate_inbound_address(user_id, display_name)
        s.run(
            "MATCH (u:User {id: $uid}) SET u.inbound_email = $addr",
            uid=user_id, addr=addr,
        )
        return addr


def lookup_user_by_inbound_address(inbound_email: str) -> dict | None:
    """Find the User node that owns this inbound address."""
    with _driver.session() as s:
        r = s.run(
            "MATCH (u:User {inbound_email: $addr}) RETURN u.id AS id, u.email AS email, u.display_name AS name",
            addr=inbound_email.lower(),
        ).single()
        return dict(r) if r else None


# ── Email stripping ────────────────────────────────────────────────────────────

# Patterns that mark the beginning of quoted reply / forwarded content
_QUOTE_PATTERNS = [
    re.compile(r"^>+\s", re.MULTILINE),                         # "> " quoted lines
    re.compile(r"^On .{10,80} wrote:$", re.MULTILINE),          # "On Mon, Oct 28... wrote:"
    re.compile(r"^-{4,}\s*(Original Message|Forwarded message)", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^From:\s+\S+@\S+", re.MULTILINE),              # forwarding headers
    re.compile(r"^Sent from my (iPhone|Android|Galaxy)", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^\s*--\s*$", re.MULTILINE),                    # signature marker "-- "
]

_FORWARD_SUBJECT_RE = re.compile(r"^(Fwd?:|Re:)\s*", re.IGNORECASE)


def strip_email_body(text: str, subject: str = "") -> tuple[str, bool]:
    """
    Strip quoted replies and signatures from an email body.
    Returns (cleaned_text, is_forward).
    """
    is_forward = bool(_FORWARD_SUBJECT_RE.match(subject or ""))

    if is_forward:
        # For forwards: keep everything but clean up forwarding header lines
        text = re.sub(
            r"^-{3,}\s*Forwarded message\s*-{3,}.*?^(From:|To:|Subject:|Date:)",
            r"\1",
            text, flags=re.MULTILINE | re.DOTALL | re.IGNORECASE
        )
        return text.strip(), True

    # For regular emails: find the first quote marker and cut there
    lines = text.splitlines()
    clean_lines = []
    for line in lines:
        is_quote = any(p.match(line) for p in _QUOTE_PATTERNS[:3])
        if is_quote:
            break
        # Signature marker
        if re.match(r"^\s*--\s*$", line):
            break
        clean_lines.append(line)

    result = "\n".join(clean_lines).strip()
    # Remove trailing blank lines
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result, False


# ── Sender classification ─────────────────────────────────────────────────────

def classify_sender(from_header: str, to_headers: list[str], cc_headers: list[str],
                    user_email: str) -> dict:
    """
    Classify who sent this email and extract relationship metadata.

    Returns:
        {
            "is_owner": bool,            # From matches user's registered email
            "contact_emails": [...],     # Other people in To/CC (for Person node creation)
            "contact_names": [...],      # Display names of those contacts
            "original_sender_email": "", # For forwards — who sent the original
            "original_sender_name": "",
        }
    """
    from_name, from_email = parseaddr(from_header)
    from_email = from_email.lower().strip()
    user_email = user_email.lower().strip()

    is_owner = (from_email == user_email)

    # Extract all To/CC recipients (excluding the ThoughtB inbound address)
    all_recipients = getaddresses(to_headers + cc_headers)
    contact_emails, contact_names = [], []
    for name, email in all_recipients:
        email = email.lower().strip()
        if not email or email == user_email or EMAIL_DOMAIN in email:
            continue
        contact_emails.append(email)
        contact_names.append(name or email.split("@")[0])

    return {
        "is_owner": is_owner,
        "from_email": from_email,
        "from_name": from_name or from_email.split("@")[0],
        "contact_emails": contact_emails,
        "contact_names": contact_names,
    }


# ── Person/Source node helpers ─────────────────────────────────────────────────

def upsert_person_from_email(user_id: str, entry_id: str,
                             contact_name: str, contact_email: str):
    """Create or find a Person node for an email contact and link to entry."""
    with _driver.session() as s:
        s.run("""
            MATCH (e:Entry {id: $eid})
            MERGE (p:Person {email: $email, user_id: $uid})
            ON CREATE SET
                p.name = $name,
                p.source = 'email_contact',
                p.influence_weight = 0.0,
                p.created_at = datetime()
            ON MATCH SET
                p.influence_weight = coalesce(p.influence_weight, 0.0) + 0.1
            MERGE (e)-[:CORRESPONDS_WITH]->(p)
            SET p.user_id = $uid
        """, eid=entry_id, email=contact_email, uid=user_id, name=contact_name)

        # Also connect to any concepts this entry surfaces
        s.run("""
            MATCH (p:Person {email: $email, user_id: $uid})
            MATCH (e:Entry {id: $eid})-[:SURFACES]->(c:Concept)
            MERGE (p)-[r:INTRODUCED]->(c)
            ON CREATE SET
                r.via_entry = $eid,
                r.at = datetime(),
                r.user_id = $uid
        """, email=contact_email, uid=user_id, eid=entry_id)


def upsert_source_from_sender(user_id: str, entry_id: str,
                               sender_name: str, sender_email: str):
    """Create or find a Source node for a forwarded newsletter/publication."""
    domain = sender_email.split("@")[-1] if "@" in sender_email else sender_email
    with _driver.session() as s:
        s.run("""
            MATCH (e:Entry {id: $eid})
            MERGE (src:Source {domain: $domain, user_id: $uid})
            ON CREATE SET
                src.name = $name,
                src.email = $email,
                src.source = 'email_forward',
                src.influence_weight = 0.0,
                src.created_at = datetime()
            ON MATCH SET
                src.influence_weight = coalesce(src.influence_weight, 0.0) + 0.1
            MERGE (e)-[:REFERENCES]->(src)
        """, eid=entry_id, domain=domain, uid=user_id, name=sender_name, email=sender_email)

        s.run("""
            MATCH (src:Source {domain: $domain, user_id: $uid})
            MATCH (e:Entry {id: $eid})-[:SURFACES]->(c:Concept)
            MERGE (src)-[r:CATALYZED]->(c)
            ON CREATE SET
                r.via_entry = $eid,
                r.at = datetime(),
                r.user_id = $uid
        """, domain=domain, uid=user_id, eid=entry_id)


# ── Confirmation email ────────────────────────────────────────────────────────

def send_confirmation(to_email: str, subject: str, entry_id: str):
    """Send a brief confirmation email via Postmark."""
    if not POSTMARK_TOKEN or POSTMARK_TOKEN == "":
        logger.info(f"[email_inbound] No POSTMARK_TOKEN — skipping confirmation to {to_email}")
        return
    try:
        requests.post(
            "https://api.postmarkapp.com/email",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Postmark-Server-Token": POSTMARK_TOKEN,
            },
            json={
                "From": CONFIRM_FROM,
                "To": to_email,
                "Subject": f"✓ Captured: {subject[:60]}",
                "TextBody": (
                    f"Your thought has been captured and is being processed into your graph.\n\n"
                    f"View it in ThoughtB — the entry should appear within a few seconds.\n\n"
                    f"—ThoughtB"
                ),
            },
            timeout=10,
        )
    except Exception as e:
        logger.warning(f"[email_inbound] Confirmation email failed: {e}")


# ── Main webhook endpoint ─────────────────────────────────────────────────────

@router.post("/inbound")
async def handle_inbound_email(request: Request, background: BackgroundTasks):
    """
    Postmark inbound webhook. Postmark POSTs parsed JSON to this endpoint.
    Configure the webhook URL in Postmark → Servers → (your server) → Settings → Inbound.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # ── Extract fields from Postmark's parsed format ───────────────────────────
    from_header  = payload.get("From", "")
    to_headers   = [payload.get("To", "")]
    cc_headers   = [payload.get("Cc", "")] if payload.get("Cc") else []
    subject      = payload.get("Subject", "").strip()
    text_body    = payload.get("TextBody", "") or payload.get("StrippedTextReply", "") or ""
    original_recipient = payload.get("OriginalRecipient", "").lower().strip()

    # ── Find which user owns this address ──────────────────────────────────────
    user = lookup_user_by_inbound_address(original_recipient)
    if not user:
        logger.warning(f"[email_inbound] Unknown inbound address: {original_recipient}")
        return {"status": "ignored", "reason": "unknown_address"}

    user_id    = user["id"]
    user_email = user["email"]

    # ── Classify sender ────────────────────────────────────────────────────────
    classification = classify_sender(from_header, to_headers, cc_headers, user_email)

    # Strict mode: only accept emails FROM the user themselves
    # (either they sent it, or they're the envelope sender for a Cc/Bcc scenario)
    if not classification["is_owner"]:
        logger.info(f"[email_inbound] Rejected: from={classification['from_email']} != {user_email}")
        return {"status": "ignored", "reason": "not_owner"}

    # ── Clean the body ─────────────────────────────────────────────────────────
    cleaned_body, is_forward = strip_email_body(text_body, subject)

    # If forward, prepend subject so Claude has context
    content_for_entry = cleaned_body
    if is_forward and subject:
        fwd_subject = re.sub(r"^Fwd?:\s*", "", subject, flags=re.IGNORECASE).strip()
        content_for_entry = f"[Forwarded: {fwd_subject}]\n\n{cleaned_body}"
    elif subject and not re.match(r"^(Re:|Fwd?:)", subject, re.IGNORECASE):
        # Prepend meaningful subject line as context
        content_for_entry = f"[{subject}]\n\n{cleaned_body}"

    if len(content_for_entry.strip()) < 10:
        logger.info(f"[email_inbound] Body too short after stripping, skipping")
        return {"status": "ignored", "reason": "body_too_short"}

    # ── Create the entry (background so webhook returns fast) ─────────────────
    background.add_task(
        _process_email_entry,
        user_id=user_id,
        user_email=user_email,
        content=content_for_entry,
        subject=subject,
        classification=classification,
        is_forward=is_forward,
    )

    return {"status": "accepted"}


def _process_email_entry(
    user_id: str,
    user_email: str,
    content: str,
    subject: str,
    classification: dict,
    is_forward: bool,
):
    """Background task: run the full entry pipeline for an inbound email."""
    try:
        entry_id   = str(uuid.uuid4())
        created_at = datetime.utcnow().isoformat()
        source     = "email_forward" if is_forward else "email"

        # 1. Write raw entry
        with _driver.session() as s:
            s.run("""
                MATCH (u:User {id: $uid})
                CREATE (e:Entry {
                    id:         $id,
                    content:    $content,
                    source:     $source,
                    created_at: datetime($created_at),
                    user_id:    $uid,
                    is_indexed: false,
                    word_count: $word_count,
                    email_subject: $subject
                })
                CREATE (e)-[:BELONGS_TO]->(u)
            """, uid=user_id, id=entry_id, content=content,
                 source=source, created_at=created_at,
                 word_count=len(content.split()), subject=subject)

        # 2. AI extraction
        extraction = _extract_fn(content)

        # 3. Write to graph
        _write_fn(user_id, entry_id, extraction)

        # 4. Smart folders (non-fatal)
        try:
            from folders_api import process_entry_for_folders
            concept_labels = [c.get("label", "").strip() for c in extraction.get("concepts", []) if c.get("label")]
            process_entry_for_folders(user_id, entry_id, concept_labels)
        except Exception as fe:
            logger.warning(f"[email_inbound] folders skipped: {fe}")

        # 5. Wire up Person/Source nodes for influence trees
        if is_forward:
            # The original sender (newsletter, blog, etc.) becomes a Source
            upsert_source_from_sender(
                user_id, entry_id,
                classification["from_name"],
                classification["from_email"],
            )
        else:
            # The email contacts become Person nodes
            for name, email in zip(
                classification["contact_names"],
                classification["contact_emails"],
            ):
                upsert_person_from_email(user_id, entry_id, name, email)

        # 6. PostHog
        if _posthog:
            try:
                _posthog.capture(user_id, "entry_created", {
                    "word_count": len(content.split()),
                    "source": source,
                    "concept_count": len(extraction.get("concepts", [])),
                })
            except Exception:
                pass

        # 7. Send confirmation
        send_confirmation(user_email, subject, entry_id)

        logger.info(f"[email_inbound] Entry {entry_id} created for user {user_id} via {source}")

    except Exception as e:
        logger.error(f"[email_inbound] Pipeline failed: {e}", exc_info=True)


# ── Settings endpoint: get/reveal the user's inbound address ─────────────────

@router.get("/address")
def get_inbound_address(request: Request):
    """Return the user's personal inbound email address (creates it if missing).
    Auth is handled via the auth module injected at registration time."""
    from auth import get_current_user
    from fastapi import Depends
    # Called directly — we pull user from Authorization header
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    from auth import decode_token
    current_user = decode_token(token)
    addr = ensure_user_inbound_address(
        current_user["user_id"],
        current_user.get("display_name", current_user.get("email", "user")),
    )
    return {"inbound_email": addr}


# ── Registration hook called from api.py ──────────────────────────────────────

def register_email_routes(app, driver, extract_fn, write_fn, posthog=None):
    global _driver, _extract_fn, _write_fn, _posthog
    _driver     = driver
    _extract_fn = extract_fn
    _write_fn   = write_fn
    _posthog    = posthog
    app.include_router(router)
