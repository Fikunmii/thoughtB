"""
ingest.py — Thought Biography Core Ingestion Engine
----------------------------------------------------
Takes a plain text journal entry, extracts structured thought data
via Claude, and writes all nodes + edges into Neo4j.

Usage:
    python ingest.py --entry "path/to/entry.txt"
    python ingest.py --text "Today I realized that freedom means..."
    python ingest.py --batch "path/to/entries_folder/"

Requirements:
    pip install anthropic neo4j python-dotenv
"""

import os
import json
import uuid
import argparse
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
import anthropic
from neo4j import GraphDatabase

load_dotenv()

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
NEO4J_URI         = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER        = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD    = os.getenv("NEO4J_PASSWORD", "password")

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


# ─────────────────────────────────────────────
# PROMPT TEMPLATE
# ─────────────────────────────────────────────

SYSTEM_PROMPT = """
You are a philosopher-analyst embedded in a personal knowledge system called Thought Biography.
Your job is to read a journal entry and extract its intellectual and emotional DNA.

You must return ONLY a valid JSON object — no preamble, no explanation, no markdown fences.

The JSON must follow this exact schema:

{
  "significance_score": float (0.0–1.0, how intellectually/emotionally significant is this entry?),
  "emotional_tone": one of ["certain", "searching", "resolved", "ambivalent", "distressed", "euphoric", "reflective", "conflicted"],
  "summary": string (1–2 sentences capturing the core thought),
  "concepts": [
    {
      "label": string (capitalize, e.g. "Freedom", "Justice", "Ambition"),
      "weight": float (0.0–1.0, how central to this entry?),
      "context_snippet": string (the most relevant sentence mentioning this concept),
      "is_new_definition": boolean (does the writer seem to be redefining this concept?),
      "definition_note": string or null (if is_new_definition, describe the shift briefly)
    }
  ],
  "people_mentioned": [string] (real people — authors, mentors, historical figures),
  "sources_referenced": [string] (books, articles, podcasts explicitly or implicitly referenced),
  "contradicts_concepts": [string] (concept labels that seem in tension with the dominant ideas),
  "reinforces_concepts": [string] (concept labels that align with the dominant ideas),
  "life_context_hint": string or null (infer a life phase if detectable: career, relationship, education, etc.),
  "open_question": string or null (the central unresolved question this entry circles around)
}

Rules:
- Extract 2–6 concepts. Never fewer than 2, never more than 6.
- concept labels must be single words or short phrases (max 3 words).
- Be precise about significance_score. Most entries are 0.3–0.6. Reserve 0.8+ for genuine epiphanies.
- The open_question should be the thing the writer doesn't yet know the answer to.
- Never invent people or sources not present in the text.
""".strip()


def build_user_prompt(entry_text: str, entry_date: str = None) -> str:
    date_line = f"Entry date: {entry_date}\n\n" if entry_date else ""
    return f"{date_line}Journal Entry:\n\n{entry_text.strip()}"


# ─────────────────────────────────────────────
# CLAUDE EXTRACTION
# ─────────────────────────────────────────────

def extract_thought_structure(entry_text: str, entry_date: str = None) -> dict:
    """Call Claude and return structured thought data as a dict."""
    
    response = claude.messages.create(
        model="claude-opus-4-5",
        max_tokens=1500,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": build_user_prompt(entry_text, entry_date)
            }
        ]
    )
    
    raw = response.content[0].text.strip()
    
    # Strip accidental markdown fences if they sneak in
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    
    return json.loads(raw)


# ─────────────────────────────────────────────
# NEO4J WRITER
# ─────────────────────────────────────────────

class ThoughtGraphWriter:
    
    def __init__(self, uri: str, user: str, password: str):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
    
    def close(self):
        self.driver.close()
    
    def ensure_indexes(self):
        """Create indexes if they don't exist. Safe to run on every startup."""
        with self.driver.session() as session:
            indexes = [
                "CREATE INDEX entry_created IF NOT EXISTS FOR (e:Entry) ON (e.created_at)",
                "CREATE INDEX concept_label IF NOT EXISTS FOR (c:Concept) ON (c.label)",
                "CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)",
                "CREATE INDEX source_title IF NOT EXISTS FOR (s:Source) ON (s.title)",
                "CREATE FULLTEXT INDEX entry_content IF NOT EXISTS FOR (e:Entry) ON EACH [e.content]",
            ]
            for idx in indexes:
                try:
                    session.run(idx)
                except Exception:
                    pass  # Index already exists
        print("✓ Indexes verified")
    
    def write_entry(self, entry_text: str, structured: dict, entry_date: str = None) -> str:
        """
        Write a full entry and all its relationships into Neo4j.
        Returns the entry's UUID.
        """
        entry_id = str(uuid.uuid4())
        now = entry_date or datetime.now(timezone.utc).isoformat()
        
        with self.driver.session() as session:
            
            # 1. Create the Entry node
            session.run("""
                CREATE (e:Entry {
                    id: $id,
                    content: $content,
                    created_at: $created_at,
                    source: 'journal',
                    word_count: $word_count,
                    significance_score: $significance_score,
                    emotional_tone: $emotional_tone,
                    summary: $summary,
                    open_question: $open_question,
                    is_indexed: true
                })
            """, {
                "id": entry_id,
                "content": entry_text,
                "created_at": now,
                "word_count": len(entry_text.split()),
                "significance_score": structured.get("significance_score", 0.5),
                "emotional_tone": structured.get("emotional_tone", "reflective"),
                "summary": structured.get("summary", ""),
                "open_question": structured.get("open_question")
            })
            print(f"  ✓ Entry node created [{entry_id[:8]}...]")
            
            # 2. Create/merge Concept nodes + SURFACES edges
            for concept in structured.get("concepts", []):
                session.run("""
                    MERGE (c:Concept {label: $label})
                    ON CREATE SET
                        c.id = $id,
                        c.first_seen = $now,
                        c.last_seen = $now,
                        c.frequency = 1,
                        c.stability_score = 1.0,
                        c.is_core = false
                    ON MATCH SET
                        c.last_seen = $now,
                        c.frequency = c.frequency + 1
                    WITH c
                    MATCH (e:Entry {id: $entry_id})
                    CREATE (e)-[:SURFACES {
                        weight: $weight,
                        context_snippet: $context_snippet,
                        is_new_definition: $is_new_definition,
                        definition_note: $definition_note,
                        at: $now
                    }]->(c)
                """, {
                    "label": concept["label"],
                    "id": str(uuid.uuid4()),
                    "now": now,
                    "entry_id": entry_id,
                    "weight": concept.get("weight", 0.5),
                    "context_snippet": concept.get("context_snippet", ""),
                    "is_new_definition": concept.get("is_new_definition", False),
                    "definition_note": concept.get("definition_note")
                })
            
            concept_labels = [c["label"] for c in structured.get("concepts", [])]
            if concept_labels:
                print(f"  ✓ Concepts: {', '.join(concept_labels)}")
            
            # 3. Create/merge Person nodes + INTRODUCED edges
            for person_name in structured.get("people_mentioned", []):
                if not person_name.strip():
                    continue
                session.run("""
                    MERGE (p:Person {name: $name})
                    ON CREATE SET
                        p.id = $id,
                        p.first_mentioned = $now,
                        p.influence_weight = 0.0,
                        p.type = 'unknown'
                    WITH p
                    MATCH (e:Entry {id: $entry_id})
                    MERGE (e)-[:MENTIONS {at: $now}]->(p)
                """, {
                    "name": person_name,
                    "id": str(uuid.uuid4()),
                    "now": now,
                    "entry_id": entry_id
                })
            
            # 4. Create/merge Source nodes + REFERENCED edges
            for source_title in structured.get("sources_referenced", []):
                if not source_title.strip():
                    continue
                session.run("""
                    MERGE (s:Source {title: $title})
                    ON CREATE SET
                        s.id = $id,
                        s.consumed_at = $now,
                        s.impact_score = 0.0,
                        s.type = 'unknown'
                    WITH s
                    MATCH (e:Entry {id: $entry_id})
                    MERGE (e)-[:REFERENCES {at: $now}]->(s)
                """, {
                    "title": source_title,
                    "id": str(uuid.uuid4()),
                    "now": now,
                    "entry_id": entry_id
                })
            
            # 5. Create REINFORCES edges between concepts
            main_concepts = [c["label"] for c in structured.get("concepts", [])]
            for reinforced in structured.get("reinforces_concepts", []):
                if reinforced in main_concepts:
                    continue  # Skip self-references
                session.run("""
                    MERGE (c1:Concept {label: $from_label})
                    ON CREATE SET c1.id = $c1_id, c1.frequency = 0, c1.stability_score = 1.0, c1.is_core = false
                    MERGE (c2:Concept {label: $to_label})
                    ON CREATE SET c2.id = $c2_id, c2.frequency = 0, c2.stability_score = 1.0, c2.is_core = false
                    MERGE (c1)-[r:REINFORCES]->(c2)
                    ON CREATE SET r.first_observed = $now, r.strength = 0.5
                    ON MATCH SET r.strength = r.strength + 0.1
                """, {
                    "from_label": main_concepts[0] if main_concepts else "Unknown",
                    "to_label": reinforced,
                    "c1_id": str(uuid.uuid4()),
                    "c2_id": str(uuid.uuid4()),
                    "now": now
                })
            
            # 6. Create CONTRADICTS edges
            for contradicted in structured.get("contradicts_concepts", []):
                session.run("""
                    MERGE (c1:Concept {label: $from_label})
                    ON CREATE SET c1.id = $c1_id, c1.frequency = 0, c1.stability_score = 1.0, c1.is_core = false
                    MERGE (c2:Concept {label: $to_label})
                    ON CREATE SET c2.id = $c2_id, c2.frequency = 0, c2.stability_score = 1.0, c2.is_core = false
                    MERGE (c1)-[r:CONTRADICTS]->(c2)
                    ON CREATE SET r.first_observed = $now, r.tension_score = 0.5, r.resolved = false
                    ON MATCH SET r.tension_score = r.tension_score + 0.1
                """, {
                    "from_label": main_concepts[0] if main_concepts else "Unknown",
                    "to_label": contradicted,
                    "c1_id": str(uuid.uuid4()),
                    "c2_id": str(uuid.uuid4()),
                    "now": now
                })
            
            # 7. Create LifeContext node + OCCURRED_DURING edge
            life_context = structured.get("life_context_hint")
            if life_context:
                session.run("""
                    MERGE (lc:LifeContext {label: $label})
                    ON CREATE SET
                        lc.id = $id,
                        lc.start = $now,
                        lc.type = 'inferred'
                    WITH lc
                    MATCH (e:Entry {id: $entry_id})
                    MERGE (e)-[:OCCURRED_DURING]->(lc)
                """, {
                    "label": life_context,
                    "id": str(uuid.uuid4()),
                    "now": now,
                    "entry_id": entry_id
                })
        
        return entry_id


# ─────────────────────────────────────────────
# INGESTION PIPELINE
# ─────────────────────────────────────────────

def ingest_entry(text: str, entry_date: str = None, dry_run: bool = False):
    """Full pipeline: text → Claude → Neo4j."""
    
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("📖 INGESTING ENTRY")
    print(f"   Words: {len(text.split())}")
    if entry_date:
        print(f"   Date: {entry_date}")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    
    # Step 1: Extract structure via Claude
    print("🧠 Extracting thought structure...")
    structured = extract_thought_structure(text, entry_date)
    
    print(f"\n  Significance:  {structured.get('significance_score', '?')}")
    print(f"  Tone:          {structured.get('emotional_tone', '?')}")
    print(f"  Summary:       {structured.get('summary', '?')}")
    if structured.get('open_question'):
        print(f"  Open Question: {structured.get('open_question')}")
    
    if dry_run:
        print("\n[DRY RUN] Skipping Neo4j write. Full extraction:")
        print(json.dumps(structured, indent=2))
        return structured
    
    # Step 2: Write to Neo4j
    print("\n🔗 Writing to graph...")
    writer = ThoughtGraphWriter(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
    
    try:
        writer.ensure_indexes()
        entry_id = writer.write_entry(text, structured, entry_date)
        print(f"\n✅ Entry ingested successfully")
        print(f"   Entry ID: {entry_id}")
    finally:
        writer.close()
    
    return structured


def ingest_batch(folder_path: str):
    """Ingest all .txt files from a folder, sorted by filename (use dates as filenames)."""
    folder = Path(folder_path)
    files = sorted(folder.glob("*.txt"))
    
    print(f"\nFound {len(files)} entries to ingest from {folder_path}")
    
    for i, file_path in enumerate(files, 1):
        print(f"\n[{i}/{len(files)}] {file_path.name}")
        text = file_path.read_text(encoding="utf-8")
        
        # Try to extract date from filename (e.g., 2024-03-15.txt)
        date_hint = None
        stem = file_path.stem
        if len(stem) == 10 and stem[4] == '-' and stem[7] == '-':
            date_hint = stem + "T00:00:00+00:00"
        
        ingest_entry(text, entry_date=date_hint)


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Thought Biography Ingestion Engine")
    
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--entry", type=str, help="Path to a .txt journal entry file")
    group.add_argument("--text", type=str, help="Raw journal entry text (quoted string)")
    group.add_argument("--batch", type=str, help="Path to folder of .txt entry files")
    
    parser.add_argument("--date", type=str, help="ISO date for the entry (e.g. 2024-03-15)", default=None)
    parser.add_argument("--dry-run", action="store_true", help="Extract structure but don't write to Neo4j")
    
    args = parser.parse_args()
    
    if args.batch:
        ingest_batch(args.batch)
    elif args.entry:
        text = Path(args.entry).read_text(encoding="utf-8")
        ingest_entry(text, entry_date=args.date, dry_run=args.dry_run)
    elif args.text:
        ingest_entry(args.text, entry_date=args.date, dry_run=args.dry_run)
