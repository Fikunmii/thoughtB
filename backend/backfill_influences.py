"""
backfill_influences.py — Re-extract people/sources from existing entries
and create INTRODUCED/CATALYZED edges for Influence Trees.
"""
import os, json, uuid
import anthropic
from neo4j import GraphDatabase

NEO4J_URI      = "neo4j+s://b18adf80.databases.neo4j.io"
NEO4J_USER     = "b18adf80"
NEO4J_PASSWORD = "quECs8RUEzmD2bv2YIWyw1cvp5Dq-I953SEOJUoggU8"
ANTHROPIC_KEY  = os.getenv("ANTHROPIC_API_KEY")

EXTRACTION_PROMPT = """You are a philosophical analyst reading a journal entry.
Extract structured data and return ONLY valid JSON — no preamble, no markdown.

Return this exact shape:
{
  "people_mentioned": ["Name1", "Name2"],
  "sources_referenced": ["Book/Article Title"]
}"""

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
claude = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

with driver.session() as s:
    entries = s.run("MATCH (e:Entry) RETURN e.id AS id, e.content AS content, e.user_id AS uid").data()
    print(f"Found {len(entries)} entries to process")

    for entry in entries:
        eid  = entry["id"]
        uid  = entry["uid"]
        text = entry["content"]
        if not text or not uid:
            continue

        # Extract via Claude
        try:
            resp = claude.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=300,
                system=EXTRACTION_PROMPT,
                messages=[{"role": "user", "content": text}],
            )
            raw = resp.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            data = json.loads(raw)
        except Exception as e:
            print(f"  ✗ Entry {eid[:8]}: extraction failed — {e}")
            continue

        people  = [p.strip() for p in data.get("people_mentioned", [])  if p.strip()]
        sources = [s.strip() for s in data.get("sources_referenced", []) if s.strip()]

        if not people and not sources:
            print(f"  — Entry {eid[:8]}: no people or sources found")
            continue

        print(f"  ✓ Entry {eid[:8]}: {people} | {sources}")

        # Get concepts for this entry
        with driver.session() as s2:
            concepts = [r["label"] for r in s2.run(
                "MATCH (e:Entry {id:$eid})-[:SURFACES]->(c:Concept) RETURN c.label AS label",
                eid=eid
            ).data()]

            # Create Person nodes + INTRODUCED edges
            for name in people:
                s2.run("""
                    MERGE (p:Person {name: $name, user_id: $uid})
                    ON CREATE SET
                        p.id              = $pid,
                        p.type            = 'Person',
                        p.first_mentioned = datetime(),
                        p.influence_weight = 0.0,
                        p.user_id         = $uid
                """, name=name, uid=uid, pid=str(uuid.uuid4()))

                for clabel in concepts:
                    s2.run("""
                        MATCH (p:Person {name: $name, user_id: $uid})
                        MATCH (c:Concept {label: $label, user_id: $uid})
                        MERGE (p)-[r:INTRODUCED]->(c)
                        ON CREATE SET r.via_entry=$eid, r.at=datetime(), r.user_id=$uid
                        WITH p
                        SET p.influence_weight = coalesce(p.influence_weight,0.0) + 0.1
                    """, name=name, uid=uid, label=clabel, eid=eid)

            # Create Source nodes + CATALYZED edges
            for title in sources:
                s2.run("""
                    MERGE (src:Source {title: $title, user_id: $uid})
                    ON CREATE SET
                        src.id             = $sid,
                        src.type           = 'Book',
                        src.consumed_at    = datetime(),
                        src.influence_weight = 0.0,
                        src.user_id        = $uid
                """, title=title, uid=uid, sid=str(uuid.uuid4()))

                for clabel in concepts:
                    s2.run("""
                        MATCH (src:Source {title: $title, user_id: $uid})
                        MATCH (c:Concept {label: $label, user_id: $uid})
                        MERGE (src)-[r:CATALYZED]->(c)
                        ON CREATE SET r.via_entry=$eid, r.at=datetime(), r.user_id=$uid
                        WITH src
                        SET src.influence_weight = coalesce(src.influence_weight,0.0) + 0.1
                    """, title=title, uid=uid, label=clabel, eid=eid)

driver.close()
print("\nBackfill complete.")
