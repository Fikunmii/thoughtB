"""
backfill_influences.py — Backfill INTRODUCED/CATALYZED edges for existing data.

Run once against your live Neo4j database to fix existing entries that were
ingested before the influence edge creation was added.

Usage:
    python backfill_influences.py
"""
import os
from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

driver = GraphDatabase.driver(
    os.getenv("NEO4J_URI"),
    auth=(os.getenv("NEO4J_USER"), os.getenv("NEO4J_PASSWORD"))
)

with driver.session() as s:
    # 1. For each Person, find all entries that mention them,
    #    then link that person to all concepts in those entries via INTRODUCED
    result = s.run("""
        MATCH (e:Entry)-[:MENTIONS]->(p:Person)
        MATCH (e)-[:SURFACES]->(c:Concept)
        WHERE e.user_id IS NOT NULL
        MERGE (p)-[r:INTRODUCED]->(c)
        ON CREATE SET
            r.via_entry = e.id,
            r.at        = datetime(),
            r.user_id   = e.user_id
        WITH p, e
        SET p.user_id         = e.user_id,
            p.influence_weight = coalesce(p.influence_weight, 0.0) + 0.1
        RETURN count(r) AS created
    """)
    r = result.single()
    print(f"Person INTRODUCED edges: {r['created'] if r else 0}")

    # 2. For each Source, find all entries that reference them,
    #    then link that source to all concepts via CATALYZED
    result2 = s.run("""
        MATCH (e:Entry)-[:REFERENCES]->(src:Source)
        MATCH (e)-[:SURFACES]->(c:Concept)
        WHERE e.user_id IS NOT NULL
        MERGE (src)-[r:CATALYZED]->(c)
        ON CREATE SET
            r.via_entry = e.id,
            r.at        = datetime(),
            r.user_id   = e.user_id
        WITH src, e
        SET src.user_id          = e.user_id,
            src.influence_weight = coalesce(src.influence_weight, 0.0) + 0.1
        RETURN count(r) AS created
    """)
    r2 = result2.single()
    print(f"Source CATALYZED edges: {r2['created'] if r2 else 0}")

driver.close()
print("Backfill complete.")
