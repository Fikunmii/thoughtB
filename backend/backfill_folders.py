"""
backfill_folders.py — Run smart-folder auto-assign/clustering logic against
existing entries that predate the folders feature.

Usage (from backend/, with env vars set):
  NEO4J_URI=... NEO4J_USER=... NEO4J_PASSWORD=... ANTHROPIC_API_KEY=... \
    python3 backfill_folders.py
"""
import os
import sys

# Make this script usable standalone (it imports folders_api, which lazily
# imports `driver`/`claude` from api.py — so we fake a minimal api module
# pointing at the same Neo4j/Anthropic clients instead of booting the whole
# FastAPI app).
import types
from neo4j import GraphDatabase
import anthropic

NEO4J_URI      = os.getenv("NEO4J_URI")
NEO4J_USER     = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
ANTHROPIC_KEY  = os.getenv("ANTHROPIC_API_KEY")

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    print("Missing NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD env vars.")
    sys.exit(1)

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
claude = anthropic.Anthropic(api_key=ANTHROPIC_KEY) if ANTHROPIC_KEY else None

# Inject a fake `api` module into sys.modules so `folders_api`'s lazy
# `from api import driver` / `from api import claude` resolve to these.
fake_api = types.ModuleType("api")
fake_api.driver = driver
fake_api.claude = claude
sys.modules["api"] = fake_api

from folders_api import process_entry_for_folders  # noqa: E402

with driver.session() as s:
    entries = s.run("""
        MATCH (e:Entry)
        OPTIONAL MATCH (e)-[:SURFACES]->(c:Concept)
        WITH e, collect(DISTINCT c.label) AS labels
        RETURN e.id AS id, e.user_id AS uid, e.created_at AS created_at, labels
        ORDER BY e.created_at ASC
    """).data()

print(f"Found {len(entries)} entries to process for folder clustering")

for i, entry in enumerate(entries, 1):
    labels = [l for l in (entry["labels"] or []) if l]
    if not labels:
        print(f"  [{i}/{len(entries)}] {entry['id']}: no concepts, skipping")
        continue
    process_entry_for_folders(entry["uid"], entry["id"], labels)
    print(f"  [{i}/{len(entries)}] {entry['id']}: processed ({len(labels)} concepts)")

driver.close()
print("Folder backfill complete.")
