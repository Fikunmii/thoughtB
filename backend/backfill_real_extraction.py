"""
backfill_real_extraction.py
----------------------------
One-time fix for entries created before the /entries endpoint was patched.

Those entries were all written with a hardcoded fake extraction
(always "Freedom"/"Meaning", always "Viktor Frankl", always the same
open question). This script:

  1. Wipes the fake Concept graph + fake Person/Source links tied to
     your account (the underlying journal entries/content are untouched).
  2. Re-runs every entry's real text through the actual Claude extraction
     pipeline and rebuilds the graph from genuine results.

Run this ONCE, after deploying the api.py/search_api.py fix, and only
for entries that were created by the old buggy code.

Usage:
    cd backend
    python backfill_real_extraction.py --email you@example.com

Requires the same environment variables your backend uses
(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, ANTHROPIC_API_KEY) —
run it from an environment where those are set (e.g. with your
backend/.env loaded, or paste them as env vars before running).
"""
import argparse
import time

from api import driver, extract_with_claude, write_extraction_to_graph


def get_user_id(email: str) -> str:
    with driver.session() as s:
        rec = s.run("MATCH (u:User {email: $email}) RETURN u.id AS id", email=email).single()
        if not rec:
            raise SystemExit(f"No user found with email {email}")
        return rec["id"]


def wipe_existing_concept_data(uid: str):
    with driver.session() as s:
        # This user's entire Concept graph is fake — remove it cleanly.
        s.run("MATCH (c:Concept)-[:BELONGS_TO]->(:User {id:$uid}) DETACH DELETE c", uid=uid)
        # Person/Source nodes are shared globally, so don't delete the nodes —
        # just remove the fake links this user's entries created to them.
        s.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id:$uid})
            OPTIONAL MATCH (e)-[m:MENTIONS]->(:Person)
            DELETE m
        """, uid=uid)
        s.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id:$uid})
            OPTIONAL MATCH (e)-[ref:REFERENCES]->(:Source)
            DELETE ref
        """, uid=uid)
        # Clear stale per-entry fields so they get rewritten cleanly below.
        s.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id:$uid})
            SET e.open_question = null, e.is_indexed = false
        """, uid=uid)


def get_entries(uid: str):
    with driver.session() as s:
        result = s.run("""
            MATCH (e:Entry)-[:BELONGS_TO]->(:User {id:$uid})
            RETURN e.id AS id, e.content AS content
            ORDER BY e.created_at ASC
        """, uid=uid)
        return [dict(r) for r in result]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True, help="Account email to backfill")
    args = parser.parse_args()

    uid = get_user_id(args.email)
    entries = get_entries(uid)
    print(f"Found {len(entries)} entries for {args.email}")

    if not entries:
        print("Nothing to do.")
        return

    print("Wiping fake concept/person/source data tied to this account...")
    wipe_existing_concept_data(uid)

    for i, entry in enumerate(entries, 1):
        content = entry["content"] or ""
        if not content.strip():
            print(f"[{i}/{len(entries)}] Skipping empty entry {entry['id'][:8]}")
            continue
        print(f"[{i}/{len(entries)}] Re-extracting entry {entry['id'][:8]}...")
        extraction = extract_with_claude(content)
        write_extraction_to_graph(uid, entry["id"], extraction)
        time.sleep(0.5)  # gentle on Anthropic API rate limits

    print("Done. Your graph now reflects real extracted concepts.")


if __name__ == "__main__":
    main()
