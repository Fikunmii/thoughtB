"""
biography_generator.py — Thought Biography Document Generator
Works with any amount of data: 5 entries minimum, no LifeContext or core concepts required.
"""

import os
import asyncio
from typing import AsyncGenerator, Dict, Any
from dotenv import load_dotenv
import anthropic

load_dotenv()

claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

WRITER_SYSTEM = """
You are writing a biography of someone's intellectual and emotional life.
You have access to everything they have written privately. Write as if you knew them deeply.
Not as a therapist. Not as a coach. As a biographer who read every word.

Rules — follow all of them:
- Use their exact phrases from the entries. Not paraphrases. The actual words they wrote.
- Name the specific moments their thinking shifted. Give dates where visible.
- Be honest about what has not resolved. Unresolved tension is more interesting than false clarity.
- Write in third person: "they", "the writer". Never "you" or "I". Never "the user".
- Make uncomfortable accurate observations if the entries support them.
- Do not flatter. Do not summarise. Do not say "the writer demonstrates growth".
- Avoid all clichés: no "journey", no "growth", no "self-discovery", no "passion".
- Write flowing literary prose. No bullet points. No headers inside sections.
- Every paragraph should contain at least one phrase lifted directly from the entries.
- Write as if this document will be printed and given to the person as a gift they will re-read in 10 years.
""".strip()


def _entry_block(entries: list, limit: int = 12, max_chars: int = 700) -> str:
    lines = []
    for e in entries[:limit]:
        date = (e.get("created_at") or "")[:10]
        content = (e.get("content") or e.get("summary") or "")[:max_chars]
        tone = e.get("emotional_tone", "")
        question = e.get("open_question", "")
        if content:
            block = f"[{date}{', ' + tone if tone else ''}]\n{content}"
            if question:
                block += f"\nOpen question: {question}"
            lines.append(block)
    return "\n\n---\n\n".join(lines) if lines else "No entry content available."


def _pick_top_concepts(nodes: list, limit: int = 6) -> list:
    """Pick core concepts, falling back to highest-frequency concepts."""
    core = [n for n in nodes if n.get("core") and n.get("type") == "concept"]
    if core:
        return core[:limit]
    concepts = [n for n in nodes if n.get("type") == "concept"]
    return sorted(concepts, key=lambda n: n.get("frequency", 0), reverse=True)[:limit]


async def _stream_section(prompt: str, max_tokens: int = 700) -> AsyncGenerator[str, None]:
    with claude.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        system=WRITER_SYSTEM,
        messages=[{"role": "user", "content": prompt}]
    ) as stream:
        for text in stream.text_stream:
            yield text


async def generate_biography(graph_data: dict) -> AsyncGenerator[Dict[str, Any], None]:
    sections = {}
    nodes     = graph_data.get("nodes", [])
    edges     = graph_data.get("edges", [])
    entries   = graph_data.get("entries", [])

    if not entries:
        yield {"section": "__complete__", "text": "", "status": "done",
               "sections": {}, "full_text": "Not enough entries to generate a biography yet."}
        return

    top_concepts    = _pick_top_concepts(nodes)
    unstable        = [n for n in nodes if n.get("type") == "concept" and (n.get("stability") or 1) < 0.6]
    eras            = [n["id"] for n in nodes if n.get("type") == "era"]
    open_questions  = [e.get("open_question") for e in entries if e.get("open_question")]
    concept_histories = graph_data.get("concept_histories", {})

    # spread: first 3, middle 3, last 3
    mid = len(entries) // 2
    spread = entries[:3] + entries[max(0, mid-1):mid+2] + entries[-3:]
    spread = list({e.get("created_at"): e for e in spread}.values())  # deduplicate

    # ── PASS 1: Opening ──────────────────────────────────────────────────────
    concept_labels   = [n["id"] for n in top_concepts]
    contradiction_pairs = [(e["source"], e["target"]) for e in edges if e["type"] == "CONTRADICTS"][:3]
    tensions_str     = ", ".join([f"{a} vs {b}" for a, b in contradiction_pairs]) or "none yet identified"
    questions_str    = "\n".join([f'- "{q}"' for q in open_questions[:4]]) or "none explicitly stated"
    entry_block      = _entry_block(spread)
    total            = len(entries)
    months_span      = _months_span(entries)

    opening_prompt = f"""
You are writing a biography of someone's intellectual and emotional life.
You have access to {total} private journal entries they wrote over {months_span}.

Their thinking has circled most persistently around: {", ".join(concept_labels) or "several interconnected ideas"}.
Running tensions: {tensions_str}.
Open questions they keep returning to:
{questions_str}

Sample entries from across their writing — use their actual language, copy phrases directly:

{entry_block}

Write the opening section — approximately 300 words.

Must:
- Drop the reader into a specific observation about how this particular mind works
- Use their actual phrases from the entries above — do not paraphrase, lift the words
- Name what is distinctive and possibly uncomfortable about how they think
- End with a sentence that makes the reader want to continue

Do not introduce yourself. Do not say "this biography". Do not list topics.
Just begin. Make the first sentence earn its place.
""".strip()

    yield {"section": "opening", "text": "", "status": "generating"}
    opening_text = ""
    async for text in _stream_section(opening_prompt, max_tokens=750):
        opening_text += text
        yield {"section": "opening", "text": text, "status": "streaming"}
    sections["opening"] = opening_text
    yield {"section": "opening", "text": "", "status": "complete"}

    # ── PASS 2: Era narratives (skip if no LifeContext nodes) ─────────────────
    for i, era in enumerate(eras):
        era_entries = [e for e in entries if era.lower() in (e.get("life_context") or "").lower()]
        if not era_entries:
            continue
        era_concepts = [e["target"] for e in edges if e.get("source") == era and e.get("type") == "CONTEXT"]
        prev_era = eras[i - 1] if i > 0 else None

        era_prompt = f"""
Write a biographical chapter about the {era} period — approximately 220 words.
{"This follows the " + prev_era + " period." if prev_era else "This is the earliest recorded period."}

Concepts dominant in this period: {", ".join(era_concepts[:6]) or "various ideas"}

Journal entries from this period (use their language directly):
{_entry_block(era_entries, limit=10)}

Must:
- Open by placing the reader in this specific period of the writer's thinking
- Use their own words — lift phrases directly from the entries
- Describe what they were preoccupied with and why it mattered then
- Note which ideas were forming, which were solid, which were cracking
- End on what was unresolved — the question entering the next period
""".strip()

        yield {"section": f"era_{era}", "text": "", "status": "generating"}
        era_text = ""
        async for text in _stream_section(era_prompt, max_tokens=550):
            era_text += text
            yield {"section": f"era_{era}", "text": text, "status": "streaming"}
        sections[f"era_{era}"] = era_text
        yield {"section": f"era_{era}", "text": "", "status": "complete"}

    # ── PASS 3: Top concept arcs ──────────────────────────────────────────────
    for concept_node in top_concepts[:4]:
        label = concept_node["id"]
        history = concept_histories.get(label, {})
        snapshots = history.get("snapshots", [])
        concept_entries = [
            e for e in entries
            if label.lower() in (e.get("content") or e.get("summary") or "").lower()
        ]
        if not concept_entries:
            continue

        timeline = "\n".join([
            f"- {s['date'][:7]}: {s['definition']}"
            for s in snapshots if s.get("definition")
        ]) or "Infer the arc from the entries below."

        concept_prompt = f"""
Write a biographical section tracing the evolution of one concept — approximately 200 words.

Concept: {label}

How their relationship with this concept changed:
{timeline}

Entries where this concept appears (use their exact language):
{_entry_block(concept_entries, limit=6)}

Must:
- Begin at the earliest appearance — what did this concept mean to them then?
- Identify the moment of most significant shift — name it precisely with date if visible
- Be honest about instability — if they contradicted themselves, say so
- Use specific phrases from the entries — copy them in, do not paraphrase
- End where the concept stands now — as a current state, not a conclusion
""".strip()

        yield {"section": f"concept_{label}", "text": "", "status": "generating"}
        concept_text = ""
        async for text in _stream_section(concept_prompt, max_tokens=500):
            concept_text += text
            yield {"section": f"concept_{label}", "text": text, "status": "streaming"}
        sections[f"concept_{label}"] = concept_text
        yield {"section": f"concept_{label}", "text": "", "status": "complete"}

    # ── PASS 4: Contradictions ────────────────────────────────────────────────
    contradictions_data = graph_data.get("contradictions", [])
    major = sorted(contradictions_data, key=lambda c: c.get("tension_score", 0), reverse=True)[:3]
    for c in major:
        key = f"contradiction_{c['concept_a']}_{c['concept_b']}"
        entries_a = [e for e in entries if c["concept_a"].lower() in (e.get("content") or "").lower()]
        entries_b = [e for e in entries if c["concept_b"].lower() in (e.get("content") or "").lower()]
        if not entries_a and not entries_b:
            continue

        resolution = (
            f"This tension was eventually resolved: {c.get('resolution_note')}"
            if c.get("resolved") and c.get("resolution_note")
            else "This tension remains unresolved at the time of writing."
        )

        contra_prompt = f"""
Write a biographical section about a contradiction in the writer's thinking — approximately 180 words.

The tension: {c['concept_a']} vs {c['concept_b']}

Entries where {c['concept_a']} surfaces:
{_entry_block(entries_a, limit=3)}

Entries where {c['concept_b']} surfaces:
{_entry_block(entries_b, limit=3)}

{resolution}

Must:
- Describe the nature of this tension using language from the actual entries
- Quote or closely reproduce the most striking phrase from either set
- If resolved: describe the specific synthesis they reached
- If unresolved: end with the open question exactly as they phrased it
- Treat this contradiction as the most interesting thing about this person
""".strip()

        yield {"section": key, "text": "", "status": "generating"}
        contra_text = ""
        async for text in _stream_section(contra_prompt, max_tokens=450):
            contra_text += text
            yield {"section": key, "text": text, "status": "streaming"}
        sections[key] = contra_text
        yield {"section": key, "text": "", "status": "complete"}

    # ── PASS 5: Influences ────────────────────────────────────────────────────
    people  = graph_data.get("people", [])
    sources = graph_data.get("sources", [])
    people_str  = "\n".join([f"- {p['name']} (first mentioned {(p.get('first_mentioned') or '')[:7]}, connected to: {', '.join(p.get('concepts', [])[:3])})" for p in people[:5]])
    sources_str = "\n".join([f"- {s['title']} (around {(s.get('consumed_at') or '')[:7]}, catalyzed: {', '.join(s.get('concepts', [])[:3])})" for s in sources[:5]])

    if people_str or sources_str:
        influence_prompt = f"""
Write a biographical section about intellectual influences — approximately 180 words.

People who appear in the thinking:
{people_str or "None recorded."}

Books and sources that catalyzed shifts:
{sources_str or "None recorded."}

Journal entries to draw from:
{_entry_block(entries[:6])}

Must:
- Name which arrival mattered most and what it unlocked — be specific
- Use language from the entries to show the before/after of a key influence
- Resist hagiography — influences are catalysts, not authorities
""".strip()

        yield {"section": "influences", "text": "", "status": "generating"}
        influence_text = ""
        async for text in _stream_section(influence_prompt, max_tokens=450):
            influence_text += text
            yield {"section": "influences", "text": text, "status": "streaming"}
        sections["influences"] = influence_text
        yield {"section": "influences", "text": "", "status": "complete"}

    # ── PASS 6: Closing ───────────────────────────────────────────────────────
    recent = sorted(entries, key=lambda e: e.get("created_at") or "", reverse=True)[:5]
    questions_str2 = "\n".join([f'- "{q}"' for q in open_questions[:5] if q]) or "Infer from the most recent entries below."
    unstable_str   = ", ".join([c["id"] for c in unstable[:4]]) or "not yet identified"
    core_str       = ", ".join([n["id"] for n in top_concepts[:5]]) or "emerging"

    closing_prompt = f"""
Write the closing section of this biography — approximately 220 words.

The writer's most persistent open questions:
{questions_str2}

Concepts still in active flux: {unstable_str}
Concepts that have remained central throughout: {core_str}

Most recent entries (what they are thinking about right now):
{_entry_block(recent, limit=4)}

Must:
- Name what the writer is still in the middle of — not what they have resolved
- Use their own language from the recent entries to anchor the ending
- Make one honest, precise observation about where this mind stands now
- End with a single sentence that captures something essential and irreducible about this person
- Not be consoling. Not be triumphant. Not be summarising. Be true.

This is the last thing they will read. Make it land.
""".strip()

    yield {"section": "closing", "text": "", "status": "generating"}
    closing_text = ""
    async for text in _stream_section(closing_prompt, max_tokens=550):
        closing_text += text
        yield {"section": "closing", "text": text, "status": "streaming"}
    sections["closing"] = closing_text
    yield {"section": "closing", "text": "", "status": "complete"}

    # ── PASS 7: Revised opening ───────────────────────────────────────────────
    synthesis_prompt = f"""
You have written an intellectual biography. Now revise only the opening.

What the biography ultimately revealed (the closing ends with):
{closing_text[-700:]}

The full document covers: {" | ".join(sections.keys())}

The original opening:
{opening_text}

Rewrite the opening (approximately 300 words) so that it:
- Foreshadows what will matter most without naming it directly
- Uses language or an image that echoes the closing
- Creates the feeling of entering a specific, irreducible mind
- Contains at least one phrase lifted from the original journal entries
- Makes someone who knows nothing about this person want to read everything that follows

Return only the revised opening. Nothing else.
""".strip()

    yield {"section": "opening_revised", "text": "", "status": "generating"}
    revised_opening = ""
    async for text in _stream_section(synthesis_prompt, max_tokens=750):
        revised_opening += text
        yield {"section": "opening_revised", "text": text, "status": "streaming"}
    sections["opening"] = revised_opening
    yield {"section": "opening_revised", "text": "", "status": "complete"}

    full_text = assemble_document(sections)
    yield {
        "section": "__complete__",
        "text": "",
        "status": "done",
        "sections": sections,
        "full_text": full_text,
    }


def _months_span(entries: list) -> str:
    dates = sorted([e.get("created_at") or "" for e in entries if e.get("created_at")])
    if len(dates) < 2:
        return "a short period"
    try:
        from datetime import datetime
        d1 = datetime.fromisoformat(dates[0][:10])
        d2 = datetime.fromisoformat(dates[-1][:10])
        months = (d2.year - d1.year) * 12 + (d2.month - d1.month)
        if months < 1:
            return "a few weeks"
        return f"{months} month{'s' if months != 1 else ''}"
    except Exception:
        return "several months"


def assemble_document(sections: dict) -> str:
    parts = []

    if sections.get("opening"):
        parts.append(sections["opening"])

    era_keys = sorted([k for k in sections if k.startswith("era_")])
    if era_keys:
        parts.append("\n---\n")
        for key in era_keys:
            parts.append(f"## {key.replace('era_', '')}\n\n{sections[key]}")

    concept_keys = [k for k in sections if k.startswith("concept_")]
    if concept_keys:
        parts.append("\n---\n")
        for key in concept_keys:
            parts.append(f"## On {key.replace('concept_', '')}\n\n{sections[key]}")

    contra_keys = [k for k in sections if k.startswith("contradiction_")]
    if contra_keys:
        parts.append("\n---\n")
        for key in contra_keys:
            parts.append(sections[key])

    if sections.get("influences"):
        parts.append("\n---\n")
        parts.append(sections["influences"])

    if sections.get("closing"):
        parts.append("\n---\n")
        parts.append(sections["closing"])

    return "\n\n".join(parts)
