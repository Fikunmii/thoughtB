"""
biography_generator.py — Thought Biography Document Generator
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
You have access to everything they have written privately over months or years.
Write as if you knew them deeply. Not as a therapist. Not as a coach. As a biographer.

Your only job is to be accurate and honest about what is actually on the page.

Rules — follow all of them exactly:
- Use their exact phrases from the entries. Not paraphrases. The actual words they wrote.
- Name the specific moments their thinking shifted. Give dates or approximate periods.
- Be honest about what has not resolved. Unresolved tension is more interesting than false clarity.
- Write in third person: "they", "the writer". Never "you" or "I". Never "the user".
- Make uncomfortable accurate observations if the entries support them.
- Do not flatter. Do not summarise. Do not say "the writer demonstrates growth".
- Avoid all clichés: no "journey", no "growth", no "self-discovery", no "passion".
- Write flowing literary prose. No bullet points. No headers unless the structure requires them.
- Every paragraph should contain at least one phrase lifted directly from the entries.
- Write as if this document will be printed and given to the person as a gift they will re-read in 10 years.
""".strip()


def _entry_block(entries: list, limit: int = 12, max_chars: int = 600) -> str:
    """Format actual entry content — more content, less truncation."""
    lines = []
    for e in entries[:limit]:
        date = (e.get("created_at") or "")[:10]
        content = (e.get("content") or e.get("summary") or "")[:max_chars]
        tone = e.get("emotional_tone", "")
        question = e.get("open_question", "")
        if content:
            block = f"[{date}{', tone: ' + tone if tone else ''}]\n{content}"
            if question:
                block += f"\nOpen question: {question}"
            lines.append(block)
    return "\n\n---\n\n".join(lines) if lines else "No entry content available."


def prompt_opening(graph_data: dict) -> str:
    entries = graph_data.get("entries", [])
    total_entries = len(entries)
    core_concepts = [n["id"] for n in graph_data["nodes"] if n.get("core") and n.get("type") == "concept"][:6]
    contradictions = [(e["source"], e["target"]) for e in graph_data["edges"] if e["type"] == "CONTRADICTS"][:3]
    open_questions = [e.get("open_question") for e in entries if e.get("open_question")][:4]

    # Use a spread of entries: first 3, middle 3, last 3
    spread = entries[:3] + entries[len(entries)//2:len(entries)//2+3] + entries[-3:]
    entry_block = _entry_block(spread, limit=9)

    tensions = ", ".join([f"{a} vs {b}" for a, b in contradictions]) if contradictions else "none yet identified"
    questions = "\n".join([f'- "{q}"' for q in open_questions]) if open_questions else "none explicitly stated"

    return f"""
You are writing a biography of someone's intellectual and emotional life.
You have access to {total_entries} private journal entries they wrote.

Their thinking has circled most persistently around: {", ".join(core_concepts) or "several interconnected ideas"}.
Running tensions in their thinking: {tensions}.
Open questions they keep returning to:
{questions}

Sample entries from across their writing (use their actual language — copy phrases directly):

{entry_block}

Write the opening section of this biography — approximately 300 words.

The opening must:
- Drop the reader into a specific observation about how this particular mind works
- Use their actual phrases from the entries above — do not paraphrase
- Name what is distinctive and possibly uncomfortable about how they think
- Create the feeling that the reader is entering a specific, real mind — not a generic one
- End with a sentence that makes the reader want to continue

Do not introduce yourself. Do not say "this biography". Do not list the topics you will cover.
Just begin. Make the first sentence earn its place.
""".strip()


def prompt_era(era_name: str, era_entries: list, all_concepts: list, prev_era: str = None) -> str:
    entry_block = _entry_block(era_entries, limit=10, max_chars=700)
    concept_names = ", ".join([c for c in all_concepts[:8]]) if all_concepts else "various ideas"
    prev_line = f"This follows the {prev_era} period." if prev_era else "This is the earliest recorded period."

    return f"""
Write a biographical chapter about the {era_name} period — approximately 220 words.
{prev_line}

Concepts that dominated this period: {concept_names}

Actual journal entries from this period (use their language directly):
{entry_block}

The chapter must:
- Open by placing the reader in this specific period of the writer's thinking
- Use the writer's own words from the entries above — lift phrases directly
- Describe what they were preoccupied with and why it mattered to them then
- Note which ideas were forming, which were solid, which were cracking
- End on what was unresolved — the question or tension entering the next period

Do not summarise. Do not say "during this period, they felt...". Show it through the language they actually used.
""".strip()


def prompt_concept_arc(label: str, snapshots: list, entry_excerpts: list) -> str:
    timeline = "\n".join([
        f"- {s['date'][:7]}: {s['definition']}"
        for s in snapshots if s.get("definition")
    ])
    excerpt_block = _entry_block(entry_excerpts, limit=6, max_chars=600)

    return f"""
Write a biographical section tracing the evolution of one concept — approximately 200 words.

Concept: {label}

How their relationship with this concept changed over time:
{timeline if timeline else "Infer the arc from the entries below."}

Entries where this concept appears (use their exact language):
{excerpt_block}

The section must:
- Begin at the earliest appearance — what did this concept mean to them then?
- Identify the moment of most significant shift — name it precisely, with a date if visible
- Be honest about instability: if they contradicted themselves, say so
- Use specific phrases from the entries above — copy them in, do not paraphrase
- End where the concept stands now — not as a conclusion, as a current state

Do not say "their understanding of {label} evolved". Show the evolution through the actual writing.
""".strip()


def prompt_contradiction(concept_a: str, concept_b: str, entries_a: list, entries_b: list,
                          resolved: bool, resolution_note: str = None) -> str:
    block_a = _entry_block(entries_a, limit=4, max_chars=600)
    block_b = _entry_block(entries_b, limit=4, max_chars=600)
    resolution = (
        f"\nThis tension was eventually resolved: {resolution_note}" if resolved and resolution_note
        else "\nThis tension remains unresolved at the time of writing." if not resolved
        else ""
    )

    return f"""
Write a biographical section about a contradiction in the writer's thinking — approximately 180 words.

The tension: {concept_a} vs {concept_b}

Entries where {concept_a} surfaces (use their language):
{block_a}

Entries where {concept_b} surfaces (use their language):
{block_b}
{resolution}

The section must:
- Describe the nature of this tension using language from the actual entries
- Quote or closely reproduce the most striking phrase from either set of entries
- If resolved: describe what they actually concluded — not "they found balance" but the specific synthesis
- If unresolved: end with the open question exactly as they phrased it, or as close as the entries allow
- Treat this contradiction as the most interesting thing about this person

Do not explain the contradiction. Inhabit it.
""".strip()


def prompt_influences(people: list, sources: list, entries: list) -> str:
    people_str = "\n".join([
        f"- {p['name']} (first mentioned {(p.get('first_mentioned') or '')[:7]}, "
        f"connected to: {', '.join(p.get('concepts', [])[:3])})"
        for p in people[:6]
    ])
    sources_str = "\n".join([
        f"- {s['title']} (around {(s.get('consumed_at') or '')[:7]}, "
        f"catalyzed: {', '.join(s.get('concepts', [])[:3])})"
        for s in sources[:6]
    ])
    entry_block = _entry_block(entries[:6], max_chars=600)

    if not people_str and not sources_str:
        return f"""
Write a biographical section about intellectual formation — approximately 180 words.

No specific people or books are named in the journal yet. Write instead about the influences
visible in the writing itself — the ideas that seem to come from somewhere, the frames that
suggest a particular tradition of thought even when no source is named.

Journal entries to draw from:
{entry_block}

Use their actual language. Name what you see, even if they did not name it.
""".strip()

    return f"""
Write a biographical section about intellectual influences — approximately 180 words.

People who appear in the thinking:
{people_str if people_str else "None recorded."}

Books and sources that catalyzed shifts:
{sources_str if sources_str else "None recorded."}

Journal entries to draw from:
{entry_block}

The section must:
- Name which arrival mattered most and what it unlocked in the thinking — be specific
- Use language from the entries to show the before/after of a key influence
- Resist hagiography — influences are catalysts, not authorities
- If an influence is named but its effect is invisible in the writing, say so

Write as a map of intellectual debt, honestly rendered.
""".strip()


def prompt_closing(open_questions: list, unstable_concepts: list, core_concepts: list, recent_entries: list) -> str:
    questions = "\n".join([f'- "{q}"' for q in open_questions[:5] if q])
    unstable = ", ".join([c["id"] for c in unstable_concepts[:4]])
    core = ", ".join([c["id"] for c in core_concepts[:5]])
    entry_block = _entry_block(recent_entries, limit=4, max_chars=700)

    return f"""
Write the closing section of this biography — approximately 220 words.

The writer's most persistent open questions:
{questions if questions else "Infer from the most recent entries below."}

Concepts still in active flux: {unstable if unstable else "not yet identified"}
Concepts that have remained central throughout: {core if core else "emerging"}

Most recent entries (these are what they are thinking about right now):
{entry_block}

The closing must:
- Name what the writer is still in the middle of — not what they have resolved
- Use their own language from the recent entries to anchor the ending
- Make one honest, precise observation about where this mind stands now
- End with a single sentence or image that captures something essential and irreducible about this person
- Not be consoling. Not be triumphant. Not be summarising. Be true.

This is the last thing they will read. It should land.
""".strip()


def prompt_final_synthesis(opening: str, closing: str, sections_preview: str) -> str:
    return f"""
You have written an intellectual biography. Now revise only the opening section.

What the biography ultimately revealed (the closing ends with):
{closing[-800:] if closing else "[no closing yet]"}

The full document covers:
{sections_preview[:600]}

The original opening you wrote:
{opening}

Rewrite the opening (approximately 300 words) so that it:
- Foreshadows what will matter most without naming it directly
- Uses language or an image that echoes the closing
- Creates the feeling of entering a specific, irreducible mind
- Contains at least one phrase lifted from the original journal entries
- Makes a reader who knows nothing about this person want to read everything that follows

Return only the revised opening. Nothing else.
""".strip()


async def _stream_section(prompt: str, max_tokens: int = 600) -> AsyncGenerator[str, None]:
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
    nodes = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])
    entries = graph_data.get("entries", [])

    core_concepts = [n for n in nodes if n.get("core") and n.get("type") == "concept"]
    unstable_concepts = [n for n in nodes if n.get("type") == "concept" and (n.get("stability") or 1) < 0.6]
    eras = [n["id"] for n in nodes if n.get("type") == "era"]
    open_questions = [e.get("open_question") for e in entries if e.get("open_question")]

    # ── PASS 1: Opening ──────────────────────────────────────────────────────
    yield {"section": "opening", "text": "", "status": "generating"}
    opening_text = ""
    async for text in _stream_section(prompt_opening(graph_data), max_tokens=700):
        opening_text += text
        yield {"section": "opening", "text": text, "status": "streaming"}
    sections["opening"] = opening_text
    yield {"section": "opening", "text": "", "status": "complete"}

    # ── PASS 2: Era narratives ────────────────────────────────────────────────
    for i, era in enumerate(eras):
        era_entries = [e for e in entries if era.lower() in (e.get("life_context") or "").lower()]
        if not era_entries:
            era_entries = entries[i * (len(entries) // max(len(eras), 1)):(i + 1) * (len(entries) // max(len(eras), 1))]
        era_concepts = [e["target"] for e in edges if e.get("source") == era and e.get("type") == "CONTEXT"]
        yield {"section": f"era_{era}", "text": "", "status": "generating"}
        era_text = ""
        prev_era = eras[i - 1] if i > 0 else None
        async for text in _stream_section(prompt_era(era, era_entries, era_concepts, prev_era), max_tokens=550):
            era_text += text
            yield {"section": f"era_{era}", "text": text, "status": "streaming"}
        sections[f"era_{era}"] = era_text
        yield {"section": f"era_{era}", "text": "", "status": "complete"}

    # ── PASS 3: Core concept arcs ─────────────────────────────────────────────
    concept_histories = graph_data.get("concept_histories", {})
    for concept_node in core_concepts[:5]:
        label = concept_node["id"]
        history = concept_histories.get(label, {})
        snapshots = history.get("snapshots", [])

        concept_entries = [
            e for e in entries
            if label.lower() in (e.get("content") or e.get("summary") or "").lower()
        ]
        if not concept_entries:
            continue

        yield {"section": f"concept_{label}", "text": "", "status": "generating"}
        concept_text = ""
        async for text in _stream_section(
            prompt_concept_arc(label, snapshots, concept_entries), max_tokens=500
        ):
            concept_text += text
            yield {"section": f"concept_{label}", "text": text, "status": "streaming"}
        sections[f"concept_{label}"] = concept_text
        yield {"section": f"concept_{label}", "text": "", "status": "complete"}

    # ── PASS 4: Contradictions ────────────────────────────────────────────────
    contradictions_data = graph_data.get("contradictions", [])
    major = sorted(contradictions_data, key=lambda c: c.get("tension_score", 0), reverse=True)[:4]
    for c in major:
        key = f"contradiction_{c['concept_a']}_{c['concept_b']}"
        entries_a = [e for e in entries if c["concept_a"].lower() in (e.get("content") or "").lower()]
        entries_b = [e for e in entries if c["concept_b"].lower() in (e.get("content") or "").lower()]

        yield {"section": key, "text": "", "status": "generating"}
        contra_text = ""
        async for text in _stream_section(
            prompt_contradiction(
                c["concept_a"], c["concept_b"],
                entries_a, entries_b,
                c.get("resolved", False), c.get("resolution_note")
            ), max_tokens=450
        ):
            contra_text += text
            yield {"section": key, "text": text, "status": "streaming"}
        sections[key] = contra_text
        yield {"section": key, "text": "", "status": "complete"}

    # ── PASS 5: Influences ────────────────────────────────────────────────────
    people = graph_data.get("people", [])
    sources = graph_data.get("sources", [])
    yield {"section": "influences", "text": "", "status": "generating"}
    influence_text = ""
    async for text in _stream_section(
        prompt_influences(people, sources, entries[:6]), max_tokens=500
    ):
        influence_text += text
        yield {"section": "influences", "text": text, "status": "streaming"}
    sections["influences"] = influence_text
    yield {"section": "influences", "text": "", "status": "complete"}

    # ── PASS 6: Closing ───────────────────────────────────────────────────────
    recent_entries = sorted(entries, key=lambda e: e.get("created_at") or "", reverse=True)[:5]
    yield {"section": "closing", "text": "", "status": "generating"}
    closing_text = ""
    async for text in _stream_section(
        prompt_closing(open_questions, unstable_concepts, core_concepts, recent_entries), max_tokens=550
    ):
        closing_text += text
        yield {"section": "closing", "text": text, "status": "streaming"}
    sections["closing"] = closing_text
    yield {"section": "closing", "text": "", "status": "complete"}

    # ── PASS 7: Synthesis — rewrite opening with full context ─────────────────
    all_preview = " | ".join(list(sections.keys()))
    yield {"section": "opening_revised", "text": "", "status": "generating"}
    revised_opening = ""
    async for text in _stream_section(
        prompt_final_synthesis(opening_text, closing_text, all_preview), max_tokens=700
    ):
        revised_opening += text
        yield {"section": "opening_revised", "text": text, "status": "streaming"}
    sections["opening"] = revised_opening
    yield {"section": "opening_revised", "text": "", "status": "complete"}

    # ── Assemble and emit ─────────────────────────────────────────────────────
    full_text = assemble_document(sections)
    yield {
        "section": "__complete__",
        "text": "",
        "status": "done",
        "sections": sections,
        "full_text": full_text,
    }


def assemble_document(sections: dict) -> str:
    parts = []

    if sections.get("opening"):
        parts.append(sections["opening"])

    era_keys = sorted([k for k in sections if k.startswith("era_")])
    if era_keys:
        parts.append("\n---\n")
        for key in era_keys:
            era_name = key.replace("era_", "")
            parts.append(f"## {era_name}\n\n{sections[key]}")

    concept_keys = [k for k in sections if k.startswith("concept_")]
    if concept_keys:
        parts.append("\n---\n")
        for key in concept_keys:
            concept_name = key.replace("concept_", "")
            parts.append(f"## On {concept_name}\n\n{sections[key]}")

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
