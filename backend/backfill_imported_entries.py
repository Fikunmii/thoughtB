"""
backfill_imported_entries.py
Finds all entries created via file_import that are missing graph relationships
(no SURFACES, REINFORCES, CONTRADICTS, etc.) and re-runs them through the
full write_extraction_to_graph pipeline.

Run from backend/:
  NEO4J_URI=... NEO4J_USER=... NEO4J_PASSWORD=... ANTHROPIC_API_KEY=... python3 backfill_imported_entries.py
"""
import os, sys
os.environ.setdefault("NEO4J_URI",      "bolt://localhost:7687")
os.environ.setdefault("NEO4J_USER",     "neo4j")
os.environ.setdefault("NEO4J_PASSWORD", "")

from neo4j import GraphDatabase
driver = GraphDatabase.driver(
    os.environ["NEO4J_URI"],
    auth=(os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"])
)

# Import from api.py (must be run from backend/)
sys.path.insert(0, os.path.dirname(__file__))
from api import extract_with_claude, write_extraction_to_graph

def backfill():
    # Find imported entries with no SURFACES relationship (meaning no concepts extracted)
    with driver.session() as s:
        rows = s.run("""
            MATCH (e:Entry)
            WHERE e.source STARTS WITH 'file_import'
               OR e.source = 'limitless_import'
            AND NOT (e)-[:SURFACES]->()
            RETURN e.id AS id, e.content AS content, e.user_id AS uid
        """).data()

    print(f"Found {len(rows)} imported entries missing graph relationships")

    for i, row in enumerate(rows):
        entry_id = row["id"]
        content  = row["content"]
        uid      = row["uid"]

        if not content or not uid:
            print(f"  [{i+1}] SKIP {entry_id[:8]} — missing content or user_id")
            continue

        try:
            # Also ensure BELONGS_TO link exists
            with driver.session() as s:
                s.run("""
                    MATCH (e:Entry {id: $eid}), (u:User {id: $uid})
                    MERGE (e)-[:BELONGS_TO]->(u)
                """, eid=entry_id, uid=uid)

            extraction = extract_with_claude(content)
            write_extraction_to_graph(uid, entry_id, extraction)
            concepts = [c.get("label","") for c in extraction.get("concepts",[])]
            print(f"  [{i+1}] OK  {entry_id[:8]} — {len(concepts)} concepts: {', '.join(concepts[:4])}")
        except Exception as e:
            print(f"  [{i+1}] ERR {entry_id[:8]}: {e}")

    driver.close()
    print("Backfill complete.")

if __name__ == "__main__":
    backfill()
