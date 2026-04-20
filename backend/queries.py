"""
queries.py — Thought Biography Query Interface
-----------------------------------------------
Run pre-built graph queries to explore your thought biography.

Usage:
    python queries.py contradictions
    python queries.py evolution --concept "Freedom"
    python queries.py influences
    python queries.py era --context "Graduate School"
    python queries.py recent --limit 5
    python queries.py open-questions
"""

import os
import argparse
from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

NEO4J_URI      = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER     = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")


class ThoughtGraphReader:
    
    def __init__(self):
        self.driver = GraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASSWORD)
)
    
    def close(self):
        self.driver.close()
    
    def run(self, query, params=None):
        with self.driver.session() as session:
            result = session.run(query, params or {})
            return [record.data() for record in result]
    
    # ── QUERY 1: Unresolved contradictions ────────────────────────────────
    def contradictions(self, limit=10):
        print("\n⚡ UNRESOLVED CONTRADICTIONS\n")
        rows = self.run("""
            MATCH (c1:Concept)-[r:CONTRADICTS]->(c2:Concept)
            WHERE r.resolved = false
            RETURN c1.label AS concept_a, c2.label AS concept_b,
                   r.tension_score AS tension, r.first_observed AS since
            ORDER BY r.tension_score DESC
            LIMIT $limit
        """, {"limit": limit})
        
        if not rows:
            print("No contradictions found yet. Keep journaling.")
            return
        
        for row in rows:
            print(f"  {row['concept_a']}  ←→  {row['concept_b']}")
            print(f"  Tension score: {round(row['tension'], 2)}")
            print(f"  First observed: {row['since'][:10] if row['since'] else 'unknown'}")
            print()
    
    # ── QUERY 2: Concept evolution timeline ───────────────────────────────
    def concept_evolution(self, concept_label: str):
        print(f"\n🔄 EVOLUTION OF '{concept_label.upper()}'\n")
        
        # All entries where this concept appeared, ordered by time
        rows = self.run("""
            MATCH (e:Entry)-[r:SURFACES]->(c:Concept {label: $label})
            RETURN e.created_at AS date, e.summary AS summary,
                   r.context_snippet AS snippet, r.is_new_definition AS shifted,
                   r.definition_note AS shift_note, r.weight AS weight
            ORDER BY e.created_at ASC
        """, {"label": concept_label})
        
        if not rows:
            print(f"Concept '{concept_label}' not found in graph.")
            return
        
        for row in rows:
            date = row['date'][:10] if row['date'] else '?'
            marker = "🔀" if row['shifted'] else "·"
            print(f"  {marker} [{date}] weight={round(row['weight'], 1)}")
            if row['snippet']:
                print(f"    \"{row['snippet'][:100]}\"")
            if row['shifted'] and row['shift_note']:
                print(f"    ⟶ Shift: {row['shift_note']}")
            print()
    
    # ── QUERY 3: Most influential people ──────────────────────────────────
    def influences(self):
        print("\n🧑 MOST INFLUENTIAL PEOPLE & SOURCES\n")
        
        people = self.run("""
            MATCH (p:Person)<-[:MENTIONS]-(e:Entry)
            RETURN p.name AS name, count(e) AS mentions
            ORDER BY mentions DESC
            LIMIT 10
        """)
        
        sources = self.run("""
            MATCH (s:Source)<-[:REFERENCES]-(e:Entry)
            RETURN s.title AS title, count(e) AS references
            ORDER BY references DESC
            LIMIT 10
        """)
        
        print("  People:")
        for p in people:
            print(f"    {p['name']}  ({p['mentions']} mentions)")
        
        print("\n  Sources:")
        for s in sources:
            print(f"    {s['title']}  ({s['references']} references)")
    
    # ── QUERY 4: Era map ──────────────────────────────────────────────────
    def era_map(self, context_label: str):
        print(f"\n🗺  ERA MAP: '{context_label.upper()}'\n")
        
        rows = self.run("""
            MATCH (e:Entry)-[:OCCURRED_DURING]->(lc:LifeContext {label: $label})
            MATCH (e)-[r:SURFACES]->(c:Concept)
            RETURN c.label AS concept, sum(r.weight) AS total_weight,
                   count(e) AS entry_count
            ORDER BY total_weight DESC
            LIMIT 15
        """, {"label": context_label})
        
        if not rows:
            print(f"No entries found for context '{context_label}'.")
            return
        
        for row in rows:
            bar = "█" * int(row['total_weight'] * 10)
            print(f"  {row['concept']:<20} {bar} ({row['entry_count']} entries)")
    
    # ── QUERY 5: Recent entries ───────────────────────────────────────────
    def recent(self, limit=5):
        print(f"\n📝 RECENT ENTRIES\n")
        
        rows = self.run("""
            MATCH (e:Entry)
            RETURN e.created_at AS date, e.summary AS summary,
                   e.emotional_tone AS tone, e.significance_score AS significance,
                   e.open_question AS question
            ORDER BY e.created_at DESC
            LIMIT $limit
        """, {"limit": limit})
        
        for row in rows:
            date = row['date'][:10] if row['date'] else '?'
            sig = row['significance'] or 0
            print(f"  [{date}] {row['tone'] or '?'} | significance: {round(sig, 2)}")
            if row['summary']:
                print(f"  {row['summary']}")
            if row['question']:
                print(f"  ❓ {row['question']}")
            print()
    
    # ── QUERY 6: Open questions ───────────────────────────────────────────
    def open_questions(self):
        print("\n❓ OPEN QUESTIONS (unresolved threads)\n")
        
        rows = self.run("""
            MATCH (e:Entry)
            WHERE e.open_question IS NOT NULL
            RETURN e.open_question AS question, e.created_at AS date,
                   e.significance_score AS significance
            ORDER BY e.significance_score DESC, e.created_at DESC
            LIMIT 20
        """)
        
        if not rows:
            print("No open questions extracted yet.")
            return
        
        for i, row in enumerate(rows, 1):
            date = row['date'][:10] if row['date'] else '?'
            print(f"  {i}. [{date}] {row['question']}")
    
    # ── QUERY 7: Full graph stats ─────────────────────────────────────────
    def stats(self):
        print("\n📊 GRAPH STATISTICS\n")
        
        counts = self.run("""
            MATCH (n)
            RETURN labels(n)[0] AS label, count(n) AS count
            ORDER BY count DESC
        """)
        
        edges = self.run("""
            MATCH ()-[r]->()
            RETURN type(r) AS type, count(r) AS count
            ORDER BY count DESC
        """)
        
        print("  Nodes:")
        for row in counts:
            print(f"    {row['label']:<20} {row['count']}")
        
        print("\n  Edges:")
        for row in edges:
            print(f"    {row['type']:<20} {row['count']}")


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Thought Biography Query Interface")
    subparsers = parser.add_subparsers(dest="command")
    
    subparsers.add_parser("contradictions", help="Show unresolved conceptual contradictions")
    
    evo = subparsers.add_parser("evolution", help="Trace a concept's evolution over time")
    evo.add_argument("--concept", required=True, help="Concept label (e.g. 'Freedom')")
    
    subparsers.add_parser("influences", help="Most influential people and sources")
    
    era = subparsers.add_parser("era", help="Dominant concepts during a life context")
    era.add_argument("--context", required=True, help="Life context label (e.g. 'Graduate School')")
    
    rec = subparsers.add_parser("recent", help="Show recent entries")
    rec.add_argument("--limit", type=int, default=5)
    
    subparsers.add_parser("open-questions", help="Show all unresolved open questions")
    subparsers.add_parser("stats", help="Full graph statistics")
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        exit(1)
    
    reader = ThoughtGraphReader()
    
    try:
        if args.command == "contradictions":
            reader.contradictions()
        elif args.command == "evolution":
            reader.concept_evolution(args.concept)
        elif args.command == "influences":
            reader.influences()
        elif args.command == "era":
            reader.era_map(args.context)
        elif args.command == "recent":
            reader.recent(args.limit)
        elif args.command == "open-questions":
            reader.open_questions()
        elif args.command == "stats":
            reader.stats()
    finally:
        reader.close()

