"""
digest.py — Weekly Concept Drift Digest for Thought Biography
─────────────────────────────────────────────────────────────
Runs a background scheduler (APScheduler) that checks every user's
graph weekly and emails them a personalised digest of what moved:

  - New contradictions detected
  - Tension scores that changed significantly (±10 points)
  - Concepts that reappeared after 30+ days of silence
  - Concepts that just crossed a stability milestone (25 / 50 / 75 / 100)
  - A short Claude-written narrative tying it together

Routes:
  POST /digest/send-now          — admin: trigger digest for all users immediately
  POST /digest/preview           — user: preview their own digest without sending
  GET  /digest/settings          — user: get their digest preferences
  PUT  /digest/settings          — user: update preferences (day, time, enabled)
  POST /digest/unsubscribe       — user: disable digest emails
  POST /digest/test              — user: send a test digest to themselves right now

Register in api.py:
  from digest import register_digest_routes, start_digest_scheduler
  register_digest_routes(app)
  start_digest_scheduler()          # call after app starts
"""

import os
import json
import smtplib
import logging
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import anthropic
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from neo4j import GraphDatabase
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("digest")

# ── Clients ───────────────────────────────────────────────────────────────────
NEO4J_URI  = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "yourpassword")
driver     = GraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASSWORD)
)

claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# ── Email config ──────────────────────────────────────────────────────────────
SMTP_HOST     = os.getenv("SMTP_HOST",     "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER",     "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
EMAIL_FROM    = os.getenv("EMAIL_FROM",    "hello@thoughtbiography.com")
FRONTEND_URL  = os.getenv("FRONTEND_URL",  "https://thoughtbiography.com")

# Digest fires every Sunday at 8am by default — overridable per user
DEFAULT_DIGEST_DAY  = "sunday"
DEFAULT_DIGEST_HOUR = 8

router = APIRouter(prefix="/digest", tags=["digest"])


# ── Pydantic models ───────────────────────────────────────────────────────────
class DigestSettings(BaseModel):
    enabled:    bool = True
    day_of_week: str = DEFAULT_DIGEST_DAY   # monday … sunday
    hour:        int = DEFAULT_DIGEST_HOUR  # 0–23 UTC
    timezone:    str = "UTC"


# ── Neo4j queries ─────────────────────────────────────────────────────────────

def get_all_active_users() -> list[dict]:
    """Return all users who have digest enabled and enough entries to generate a digest."""
    with driver.session() as s:
        result = s.run("""
            MATCH (u:User)
            WHERE u.digest_enabled IS NULL OR u.digest_enabled = true
            WITH u
            MATCH (e:Entry {user_id: u.id})
            WITH u, count(e) AS entry_count
            WHERE entry_count >= 10
            RETURN u.id AS user_id, u.email AS email,
                   u.display_name AS display_name,
                   coalesce(u.digest_day,  $default_day)  AS digest_day,
                   coalesce(u.digest_hour, $default_hour) AS digest_hour
        """, default_day=DEFAULT_DIGEST_DAY, default_hour=DEFAULT_DIGEST_HOUR)
        return [dict(r) for r in result]


def get_digest_data(user_id: str) -> dict:
    """
    Pull all the signals we need from Neo4j for one user's digest.
    Returns structured data that Claude will narrate.
    """
    since = datetime.utcnow() - timedelta(days=7)
    since_str = since.isoformat()

    with driver.session() as s:

        # 1. New contradictions detected this week
        new_contradictions = s.run("""
            MATCH (u:User {id: $uid})-[:OWNS]->(a:Concept)-[r:CONTRADICTS]->(b:Concept)
            WHERE r.detected_at >= $since
            RETURN a.label AS concept_a, b.label AS concept_b,
                   r.tension_score AS score,
                   r.detected_at  AS detected_at
            ORDER BY r.tension_score DESC
            LIMIT 5
        """, uid=user_id, since=since_str).data()

        # 2. Tension scores that shifted significantly (±10 points)
        shifted_tensions = s.run("""
            MATCH (u:User {id: $uid})-[:OWNS]->(a:Concept)-[r:CONTRADICTS]->(b:Concept)
            WHERE r.previous_score IS NOT NULL
              AND abs(r.tension_score - r.previous_score) >= 10
              AND r.last_updated >= $since
            RETURN a.label AS concept_a, b.label AS concept_b,
                   r.tension_score AS current_score,
                   r.previous_score AS previous_score,
                   r.tension_score - r.previous_score AS delta
            ORDER BY abs(r.tension_score - r.previous_score) DESC
            LIMIT 5
        """, uid=user_id, since=since_str).data()

        # 3. Concepts that reappeared after 30+ days of silence
        reappeared = s.run("""
            MATCH (u:User {id: $uid})-[:OWNS]->(c:Concept)
            WHERE c.last_seen >= $since
              AND c.previous_seen IS NOT NULL
              AND duration.between(
                    date(c.previous_seen), date(c.last_seen)
                  ).days >= 30
            RETURN c.label AS concept, c.last_seen AS last_seen,
                   c.previous_seen AS previous_seen,
                   duration.between(
                     date(c.previous_seen), date(c.last_seen)
                   ).days AS dormant_days
            ORDER BY dormant_days DESC
            LIMIT 5
        """, uid=user_id, since=since_str).data()

        # 4. Concepts that crossed a stability milestone this week
        milestones = s.run("""
            MATCH (u:User {id: $uid})-[:OWNS]->(c:Concept)
            WHERE c.stability_score IS NOT NULL
              AND c.previous_stability IS NOT NULL
              AND c.stability_updated >= $since
              AND (
                   (c.previous_stability < 25  AND c.stability_score >= 25)  OR
                   (c.previous_stability < 50  AND c.stability_score >= 50)  OR
                   (c.previous_stability < 75  AND c.stability_score >= 75)  OR
                   (c.previous_stability < 100 AND c.stability_score >= 100)
              )
            RETURN c.label AS concept,
                   c.stability_score  AS current_stability,
                   c.previous_stability AS previous_stability
            ORDER BY c.stability_score DESC
            LIMIT 5
        """, uid=user_id, since=since_str).data()

        # 5. Most active concepts this week (for narrative context)
        most_active = s.run("""
            MATCH (u:User {id: $uid})-[:OWNS]->(c:Concept)
                  <-[:CONTAINS]-(e:Entry)
            WHERE e.created_at >= $since
            RETURN c.label AS concept, count(e) AS appearances
            ORDER BY appearances DESC
            LIMIT 8
        """, uid=user_id, since=since_str).data()

        # 6. Overall graph health snapshot
        graph_stats = s.run("""
            MATCH (u:User {id: $uid})-[:OWNS]->(c:Concept)
            WITH count(c) AS total_concepts
            MATCH (u)-[:OWNS]->(a:Concept)-[:CONTRADICTS]->(b:Concept)
            WITH total_concepts, count(*) AS total_contradictions
            MATCH (u)-[:AUTHORED]->(e:Entry)
            RETURN total_concepts, total_contradictions, count(e) AS total_entries
        """, uid=user_id).single()

        # 7. User display name
        user = s.run(
            "MATCH (u:User {id: $uid}) RETURN u.display_name AS name, u.email AS email",
            uid=user_id
        ).single()

    return {
        "user_id":            user_id,
        "display_name":       user["name"]  if user else "there",
        "email":              user["email"] if user else "",
        "new_contradictions": new_contradictions,
        "shifted_tensions":   shifted_tensions,
        "reappeared_concepts":reappeared,
        "milestones":         milestones,
        "most_active":        most_active,
        "total_concepts":     graph_stats["total_concepts"]     if graph_stats else 0,
        "total_contradictions":graph_stats["total_contradictions"] if graph_stats else 0,
        "total_entries":      graph_stats["total_entries"]      if graph_stats else 0,
        "week_ending":        datetime.utcnow().strftime("%B %d, %Y"),
    }


def has_anything_to_report(data: dict) -> bool:
    """Don't send a digest if nothing moved this week."""
    return any([
        data["new_contradictions"],
        data["shifted_tensions"],
        data["reappeared_concepts"],
        data["milestones"],
        data["most_active"],
    ])


# ── Claude narrative generation ───────────────────────────────────────────────

def generate_digest_narrative(data: dict) -> str:
    """
    Ask Claude to write a short, warm, intelligent narrative based on
    the week's graph movements. 3–5 sentences. First person (addressing the user).
    Literary but not flowery.
    """
    # Build a compact summary for Claude to narrate
    signals = []

    if data["new_contradictions"]:
        for c in data["new_contradictions"][:2]:
            signals.append(
                f"A new tension was detected between '{c['concept_a']}' and "
                f"'{c['concept_b']}' (tension score: {c['score']})."
            )

    if data["shifted_tensions"]:
        for c in data["shifted_tensions"][:2]:
            direction = "increased" if c["delta"] > 0 else "decreased"
            signals.append(
                f"The tension between '{c['concept_a']}' and '{c['concept_b']}' "
                f"{direction} from {c['previous_score']} to {c['current_score']}."
            )

    if data["reappeared_concepts"]:
        for c in data["reappeared_concepts"][:2]:
            signals.append(
                f"'{c['concept']}' reappeared after {c['dormant_days']} days of silence."
            )

    if data["milestones"]:
        for c in data["milestones"][:2]:
            signals.append(
                f"'{c['concept']}' crossed a stability milestone "
                f"(now at {c['current_stability']} stability)."
            )

    if data["most_active"]:
        active_list = ", ".join(f"'{c['concept']}'" for c in data["most_active"][:4])
        signals.append(f"Most active concepts this week: {active_list}.")

    if not signals:
        return (
            f"Your graph has been quiet this week, {data['display_name']}. "
            "Sometimes that means consolidation — your thinking is settling rather than shifting. "
            "Keep writing."
        )

    prompt = f"""You are writing the opening narrative of a weekly digest email for a personal knowledge 
graph product called Thought Biography. The product tracks how a person's thinking evolves over time.

The user's name is {data['display_name']}. Here is what moved in their knowledge graph this week:

{chr(10).join(f'- {s}' for s in signals)}

Write a 3-5 sentence narrative that:
- Opens with the most significant signal (the one most worth paying attention to)
- Names the specific concepts involved — don't be vague
- Is warm and intelligent, not clinical or robotic
- Treats the user as someone who takes their own thinking seriously
- Ends with one sentence that makes them want to open the app and look at their graph
- Does NOT start with "This week" or "Hello" — start with the observation itself

Write only the narrative. No subject line. No greeting. No sign-off. Just the paragraph."""

    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text.strip()


# ── Email composition ─────────────────────────────────────────────────────────

def build_digest_html(data: dict, narrative: str) -> str:
    """
    Build a clean, on-brand HTML email. Dark theme impossible in email clients —
    using cream/gold on near-white instead. Inline styles throughout.
    """
    app_url       = f"{FRONTEND_URL}/graph"
    settings_url  = f"{FRONTEND_URL}/settings/digest"
    unsub_url     = f"{FRONTEND_URL}/unsubscribe"

    def concept_badge(name: str) -> str:
        return (
            f'<span style="display:inline-block;background:#FAF3E0;border:1px solid #C8A96E;'
            f'border-radius:3px;padding:2px 8px;font-size:12px;color:#5C4A1E;'
            f'font-family:Georgia,serif;margin:2px 3px 2px 0;">{name}</span>'
        )

    def section(title: str, rows: list[str]) -> str:
        if not rows:
            return ""
        rows_html = "".join(
            f'<tr><td style="padding:7px 0;border-bottom:1px solid #EEE8DC;'
            f'font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#3D3526;'
            f'line-height:18px;">{r}</td></tr>'
            for r in rows
        )
        return f"""
        <tr><td style="padding:20px 0 6px 0;">
          <p style="margin:0 0 8px 0;font-family:Helvetica,Arial,sans-serif;
             font-size:10px;color:#8A7650;letter-spacing:1.5px;text-transform:uppercase;
             font-weight:bold;">{title}</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            {rows_html}
          </table>
        </td></tr>"""

    # Build section rows
    contradiction_rows = [
        f"{concept_badge(c['concept_a'])} &harr; {concept_badge(c['concept_b'])} "
        f"<span style='color:#8A7650;font-size:11px;'>tension {c['score']}</span>"
        for c in data["new_contradictions"]
    ]

    tension_rows = [
        f"{concept_badge(c['concept_a'])} &harr; {concept_badge(c['concept_b'])} "
        f"<span style='color:#{'C0392B' if c['delta']>0 else '27AE60'};font-size:11px;'>"
        f"{'↑' if c['delta']>0 else '↓'} {abs(c['delta'])} pts "
        f"({c['previous_score']} → {c['current_score']})</span>"
        for c in data["shifted_tensions"]
    ]

    reappeared_rows = [
        f"{concept_badge(c['concept'])} "
        f"<span style='color:#8A7650;font-size:11px;'>silent for {c['dormant_days']} days</span>"
        for c in data["reappeared_concepts"]
    ]

    milestone_rows = [
        f"{concept_badge(c['concept'])} "
        f"<span style='color:#C8A96E;font-size:11px;'>stability {c['current_stability']}</span>"
        for c in data["milestones"]
    ]

    active_badges = " ".join(concept_badge(c["concept"]) for c in data["most_active"])

    sections_html = (
        section("New contradictions detected", contradiction_rows) +
        section("Tensions that shifted", tension_rows) +
        section("Concepts that reappeared", reappeared_rows) +
        section("Stability milestones", milestone_rows) +
        (f"""<tr><td style="padding:20px 0 6px 0;">
          <p style="margin:0 0 8px 0;font-family:Helvetica,Arial,sans-serif;
             font-size:10px;color:#8A7650;letter-spacing:1.5px;text-transform:uppercase;
             font-weight:bold;">Most active this week</p>
          <p style="margin:0;">{active_badges}</p>
        </td></tr>""" if data["most_active"] else "")
    )

    stats_bar = (
        f'<span style="font-size:11px;color:#8A7650;font-family:Helvetica,Arial,sans-serif;">'
        f'{data["total_entries"]} entries &nbsp;&middot;&nbsp; '
        f'{data["total_concepts"]} concepts &nbsp;&middot;&nbsp; '
        f'{data["total_contradictions"]} active tensions'
        f'</span>'
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F3EC;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3EC;">
<tr><td align="center" style="padding:40px 16px;">

  <table width="580" cellpadding="0" cellspacing="0"
         style="background:#FFFDF8;border:1px solid #E8DCC8;border-radius:4px;max-width:580px;">

    <!-- Header -->
    <tr><td style="padding:32px 40px 20px 40px;border-bottom:2px solid #C8A96E;">
      <p style="margin:0 0 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;
         color:#8A7650;letter-spacing:2px;text-transform:uppercase;">Thought Biography</p>
      <h1 style="margin:0;font-family:Georgia,serif;font-size:22px;font-weight:normal;
          color:#1A1611;">Your week in thought</h1>
      <p style="margin:6px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;
         color:#8A7650;">Week ending {data["week_ending"]}</p>
    </td></tr>

    <!-- Narrative -->
    <tr><td style="padding:28px 40px 20px 40px;">
      <p style="margin:0;font-family:Georgia,serif;font-size:15px;line-height:24px;
         color:#1A1611;font-style:italic;">{narrative}</p>
    </td></tr>

    <!-- Divider -->
    <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #E8DCC8;margin:0;"></td></tr>

    <!-- Signal sections -->
    <tr><td style="padding:8px 40px 20px 40px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        {sections_html}
      </table>
    </td></tr>

    <!-- Stats bar -->
    <tr><td style="padding:0 40px 24px 40px;">{stats_bar}</td></tr>

    <!-- CTA -->
    <tr><td align="center" style="padding:20px 40px 32px 40px;">
      <a href="{app_url}"
         style="display:inline-block;background:#1A1611;color:#C8A96E;
                font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:bold;
                letter-spacing:0.5px;text-decoration:none;padding:12px 28px;
                border-radius:2px;">Open your graph &rarr;</a>
    </td></tr>

    <!-- Footer -->
    <tr><td style="padding:16px 40px 28px 40px;border-top:1px solid #E8DCC8;">
      <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:10px;
         color:#B0A080;line-height:16px;">
        You are receiving this because you have a Thought Biography account.<br>
        <a href="{settings_url}" style="color:#8A7650;text-decoration:underline;">
          Digest settings</a> &nbsp;&middot;&nbsp;
        <a href="{unsub_url}" style="color:#8A7650;text-decoration:underline;">
          Unsubscribe</a>
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>"""


def build_digest_text(data: dict, narrative: str) -> str:
    """Plain-text fallback."""
    lines = [
        f"THOUGHT BIOGRAPHY — Your week in thought",
        f"Week ending {data['week_ending']}",
        "",
        narrative,
        "",
        "─────────────────────────",
    ]
    if data["new_contradictions"]:
        lines.append("NEW CONTRADICTIONS")
        for c in data["new_contradictions"]:
            lines.append(f"  {c['concept_a']} ↔ {c['concept_b']}  (tension {c['score']})")
        lines.append("")
    if data["shifted_tensions"]:
        lines.append("TENSIONS THAT SHIFTED")
        for c in data["shifted_tensions"]:
            arrow = "↑" if c["delta"] > 0 else "↓"
            lines.append(f"  {c['concept_a']} ↔ {c['concept_b']}  {arrow}{abs(c['delta'])} pts")
        lines.append("")
    if data["reappeared_concepts"]:
        lines.append("CONCEPTS THAT REAPPEARED")
        for c in data["reappeared_concepts"]:
            lines.append(f"  {c['concept']}  (silent for {c['dormant_days']} days)")
        lines.append("")
    if data["milestones"]:
        lines.append("STABILITY MILESTONES")
        for c in data["milestones"]:
            lines.append(f"  {c['concept']}  stability {c['current_stability']}")
        lines.append("")
    if data["most_active"]:
        active = ", ".join(c["concept"] for c in data["most_active"])
        lines.append(f"MOST ACTIVE: {active}")
        lines.append("")
    lines += [
        f"{data['total_entries']} entries · {data['total_concepts']} concepts · "
        f"{data['total_contradictions']} active tensions",
        "",
        f"Open your graph: {FRONTEND_URL}/graph",
        f"Digest settings: {FRONTEND_URL}/settings/digest",
    ]
    return "\n".join(lines)


# ── Email sending ─────────────────────────────────────────────────────────────

def send_digest_email(to_email: str, display_name: str,
                      html_body: str, text_body: str) -> bool:
    """
    Send via SMTP. Returns True on success.
    In development (no SMTP_USER set), logs the email instead of sending.
    """
    if not SMTP_USER:
        log.info(f"[DEV] Would send digest to {to_email}:\n{text_body[:300]}...")
        return True

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Your thinking moved this week — Thought Biography"
        msg["From"]    = f"Thought Biography <{EMAIL_FROM}>"
        msg["To"]      = to_email

        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(EMAIL_FROM, to_email, msg.as_string())

        log.info(f"Digest sent to {to_email}")
        return True

    except Exception as e:
        log.error(f"Failed to send digest to {to_email}: {e}")
        return False


# ── Core digest pipeline ──────────────────────────────────────────────────────

def process_user_digest(user_id: str, force: bool = False) -> dict:
    """
    Full pipeline for one user:
    1. Pull graph signals from Neo4j
    2. Check if there's anything worth sending
    3. Generate Claude narrative
    4. Compose and send email
    5. Record the send in Neo4j
    """
    data = get_digest_data(user_id)

    if not force and not has_anything_to_report(data):
        log.info(f"Nothing to report for {user_id} — skipping digest")
        return {"user_id": user_id, "status": "skipped", "reason": "no_signals"}

    narrative  = generate_digest_narrative(data)
    html_body  = build_digest_html(data, narrative)
    text_body  = build_digest_text(data, narrative)

    sent = send_digest_email(data["email"], data["display_name"], html_body, text_body)

    # Record last sent timestamp
    with driver.session() as s:
        s.run(
            "MATCH (u:User {id: $uid}) SET u.digest_last_sent = $ts",
            uid=user_id, ts=datetime.utcnow().isoformat()
        )

    return {
        "user_id":   user_id,
        "email":     data["email"],
        "status":    "sent" if sent else "failed",
        "narrative": narrative,
        "signals": {
            "new_contradictions": len(data["new_contradictions"]),
            "shifted_tensions":   len(data["shifted_tensions"]),
            "reappeared_concepts":len(data["reappeared_concepts"]),
            "milestones":         len(data["milestones"]),
        }
    }


def run_weekly_digest():
    """Called by APScheduler every Sunday at 8am UTC."""
    log.info("Starting weekly digest run...")
    users = get_all_active_users()
    log.info(f"Processing {len(users)} users")

    results = {"sent": 0, "skipped": 0, "failed": 0}
    for user in users:
        try:
            result = process_user_digest(user["user_id"])
            results[result["status"]] += 1
        except Exception as e:
            log.error(f"Digest failed for {user['user_id']}: {e}")
            results["failed"] += 1

    log.info(f"Digest complete: {results}")
    return results


# ── Scheduler ─────────────────────────────────────────────────────────────────

_scheduler = BackgroundScheduler(timezone="UTC")

def start_digest_scheduler():
    """
    Start the background scheduler. Call this once after app startup.
    Fires every Sunday at 08:00 UTC by default.
    The scheduler respects per-user day/hour preferences by running
    hourly and checking which users are due.
    """
    if not _scheduler.running:
        # Check every hour — fire digest for users whose day+hour matches now
        _scheduler.add_job(
            _hourly_digest_check,
            CronTrigger(minute=0),        # top of every hour
            id="digest_hourly",
            replace_existing=True,
            misfire_grace_time=600,       # 10 min grace period
        )
        _scheduler.start()
        log.info("Digest scheduler started — checking hourly")


def _hourly_digest_check():
    """
    Runs at the top of every hour. Fires digest for any user whose
    configured day_of_week and hour matches the current UTC time.
    """
    now      = datetime.utcnow()
    day_name = now.strftime("%A").lower()  # "sunday"
    hour     = now.hour

    with driver.session() as s:
        users = s.run("""
            MATCH (u:User)
            WHERE (u.digest_enabled IS NULL OR u.digest_enabled = true)
              AND coalesce(u.digest_day,  $default_day)  = $day
              AND coalesce(u.digest_hour, $default_hour) = $hour
            RETURN u.id AS user_id
        """, default_day=DEFAULT_DIGEST_DAY, default_hour=DEFAULT_DIGEST_HOUR,
             day=day_name, hour=hour).data()

    for u in users:
        try:
            process_user_digest(u["user_id"])
        except Exception as e:
            log.error(f"Hourly digest error for {u['user_id']}: {e}")


# ── Routes ────────────────────────────────────────────────────────────────────

def _get_current_user_dep():
    """Lazy import to avoid circular dependency."""
    from auth import get_current_user
    return Depends(get_current_user)


@router.get("/settings")
def get_digest_settings(current_user: dict = _get_current_user_dep()):
    with driver.session() as s:
        result = s.run(
            """MATCH (u:User {id: $uid})
               RETURN coalesce(u.digest_enabled, true)    AS enabled,
                      coalesce(u.digest_day,  $def_day)   AS day_of_week,
                      coalesce(u.digest_hour, $def_hour)  AS hour,
                      coalesce(u.digest_tz,  'UTC')       AS timezone,
                      u.digest_last_sent                  AS last_sent""",
            uid=current_user["user_id"],
            def_day=DEFAULT_DIGEST_DAY,
            def_hour=DEFAULT_DIGEST_HOUR,
        ).single()

    if not result:
        raise HTTPException(404, "User not found")

    return {
        "enabled":     result["enabled"],
        "day_of_week": result["day_of_week"],
        "hour":        result["hour"],
        "timezone":    result["timezone"],
        "last_sent":   result["last_sent"],
    }


@router.put("/settings")
def update_digest_settings(
    settings: DigestSettings,
    current_user: dict = _get_current_user_dep()
):
    valid_days = {"monday","tuesday","wednesday","thursday","friday","saturday","sunday"}
    if settings.day_of_week.lower() not in valid_days:
        raise HTTPException(400, f"day_of_week must be one of: {', '.join(sorted(valid_days))}")
    if not (0 <= settings.hour <= 23):
        raise HTTPException(400, "hour must be 0–23")

    with driver.session() as s:
        s.run("""
            MATCH (u:User {id: $uid})
            SET u.digest_enabled  = $enabled,
                u.digest_day      = $day,
                u.digest_hour     = $hour,
                u.digest_tz       = $tz
        """, uid=current_user["user_id"],
             enabled=settings.enabled,
             day=settings.day_of_week.lower(),
             hour=settings.hour,
             tz=settings.timezone)

    return {"status": "updated", "settings": settings.dict()}


@router.post("/unsubscribe")
def unsubscribe(current_user: dict = _get_current_user_dep()):
    with driver.session() as s:
        s.run(
            "MATCH (u:User {id: $uid}) SET u.digest_enabled = false",
            uid=current_user["user_id"]
        )
    return {"status": "unsubscribed", "message": "You will no longer receive weekly digests."}


@router.post("/preview")
def preview_digest(current_user: dict = _get_current_user_dep()):
    """
    Generate and return a digest preview for the current user.
    Does NOT send an email. Returns the narrative and signals.
    Useful for the settings screen: 'Preview this week's digest'.
    """
    data      = get_digest_data(current_user["user_id"])
    narrative = generate_digest_narrative(data)
    html      = build_digest_html(data, narrative)

    return {
        "narrative":          narrative,
        "html_preview":       html,
        "signals": {
            "new_contradictions":  data["new_contradictions"],
            "shifted_tensions":    data["shifted_tensions"],
            "reappeared_concepts": data["reappeared_concepts"],
            "milestones":          data["milestones"],
            "most_active":         data["most_active"],
        },
        "stats": {
            "total_entries":       data["total_entries"],
            "total_concepts":      data["total_concepts"],
            "total_contradictions":data["total_contradictions"],
        },
        "week_ending": data["week_ending"],
    }


@router.post("/test")
def send_test_digest(current_user: dict = _get_current_user_dep()):
    """Send a real test digest email to the current user right now."""
    result = process_user_digest(current_user["user_id"], force=True)
    if result["status"] == "failed":
        raise HTTPException(500, "Failed to send test digest — check SMTP settings")
    return {
        "status":    "sent",
        "message":   f"Test digest sent to {result['email']}",
        "narrative": result["narrative"],
        "signals":   result["signals"],
    }


@router.post("/send-now")
def trigger_digest_all_users(
    admin_key: str,
    background_tasks: BackgroundTasks,
):
    """
    Admin endpoint: trigger digest for all eligible users immediately.
    Requires ADMIN_KEY environment variable to match.
    """
    expected = os.getenv("ADMIN_KEY", "")
    if not expected or admin_key != expected:
        raise HTTPException(403, "Invalid admin key")

    background_tasks.add_task(run_weekly_digest)
    return {"status": "queued", "message": "Digest run queued for all eligible users"}


# ── Register ──────────────────────────────────────────────────────────────────

def register_digest_routes(app):
    app.include_router(router)

