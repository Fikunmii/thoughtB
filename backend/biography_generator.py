"""
biography_generator.py — Thought Biography Document Generator
--------------------------------------------------------------
Multi-pass Claude pipeline that reads a user's actual journal entries
and generates a literary intellectual memoir in structured sections.

The document has 6 passes:
  1. Opening         — Who this person is as a thinker
  2. Era narratives  — Each life period's dominant preoccupations
  3. Concept arcs    — The story of core concepts' evolution
  4. Contradictions  — The tensions carried and how they resolved
  5. Influences      — Books and people that arrived and what they unlocked
  6. Closing         — The open questions still being lived inside
  7. Synthesis       — Revised opening with full context
"""

import os
import asyncio
from typing import AsyncGenerator, Dict, Any
from dotenv import load_dotenv
import anthropic

load_dotenv()

claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

WRITER_SYSTEM = """
You are a literary biographer specialising in intellectual and philosophical memoir.
You write in the tradition of serious personal essays — precise, honest, and humane.
Your prose is elegant but never ornate. You do not flatter. You do not psychoanalyse.
You describe the arc of thought as it actually happened, including the false starts,
the contradictions held in tension, the slow shifts that only become visible in retrospect.

Write in third person: "they", "the writer", or use the concept/idea as subject.
Never "you" or "I". Never "the user".

Rules:
- Use the person's OWN phrases and language from their journal entries wherever possible
- Quote sparingly but precisely — when you quote, make it count
- Never fabricate quotes or events not present in the source material
- Avoid clichés about "journeys" or "growth"
- Avoid psychological jargon
- Do not summarise what the reader can already see
- Write as if this document will be printed and given to the person as a gift
- It should be something they will want to re-read in 5 years
""".strip()


def _entry_block(entries: list, limit: int = 8) -> str:
    """Format actual entry content for the prompt."""
    lines = []
    for e in entries[:limit]:
        date = (e.get("created_at") or "")[:10]
        content = (e.get("content") or e.get("summary") or "")[:400]
        tone = e.get("emotional_tone", "")
        if content:
            lines.append(f"[{date}, tone: {tone}]\n{content}")
    return "\n\n---\n\n".join(lines) if lines else "No entry content available."


def prompt_opening(graph_data: dict) -> str:
    core_concepts = [n["id"] for n in graph_data["nodes"] if n.get("core") and n.get("type") == "concept"][:5]
    eras = [n["id"] for n in graph_data["nodes"] if n.get("type") == "era"]
    contradictions = [(e["source"], e["target"]) for e in graph_data["edges"] if e["type"] == "CONTRADICTS"][:3]
    entries = graph_data.get("entries", [])
    entry_block = _entry_block(entries[:5])

    return f"""
Write the opening section of an intellectual biography — approximately 250 words.

This person has kept a thought journal across {len(eras) or 1} periods of their life.
Their thinking has circled most persistently around: {", ".join(core_concepts) or "many interconnected ideas"}.
Running through their thinking are these unresolved tensions: {", ".join([f"{a} vs {b}" for a, b in contradictions]) or "none yet identified"}.

Sample entries from the journal (use their actual language):
{entry_block}

The opening should:
- Set the scene of a specific mind in motion — use their actual phrases to anchor it
- Name what is distinctive about HOW this person thinks (not just WHAT they think about)
- End with a sentence that orients the reader toward what the biography will trace

Do not list facts. Write flowing prose. Make it feel like the first page of a book worth reading.
Make it feel like it was written by someone who actually read their journal, not an AI generating text.
""".strip()


def prompt_era(era_name: str, era_entries: list, all_concepts: list, prev_era: str = None) -> str:
    entry_block = _entry_block(era_entries)
    concept_names = ", ".join([c for c in all_concepts[:6]]) if all_concepts else "various ideas"
    prev_line = f"This follows the {prev_era} period." if prev_era else "This is the earliest recorded period."

    return f"""
Write a biographical section about the {era_name} period — approximately 200 words.
{prev_line}

Dominant concepts during this period: {concept_names}

Actual journal entries from this period:
{entry_block}

The section should:
- Use the writer's own words from the entries — mirror their language and rhythm
- Describe what they were preoccupied with and why it mattered to them then
- Note which ideas were forming, which were stable, which were in tension
- End with a sense of what was about to change or what question was forming

Write flowing prose. No bullet points.
""".strip()


def prompt_concept_arc(label: str, snapshots: list, entry_excerpts: list) -> str:
    timeline = "\n".join([
        f"- {s['date'][:7]} ({s.get('era', 'unknown period')}): {s['definition']}"
        for s in snapshots
    ])
    excerpt_block = _entry_block(entry_excerpts, limit=4)

    return f"""
Write a biographical section tracing the evolution of one concept — approximately 180 words.

Concept: {label}

Definition timeline:
{timeline if timeline else "No specific timeline data — infer from the entries below."}

Relevant journal entries mentioning this concept:
{excerpt_block}

The section should:
- Trace the arc from the earliest appearance to the most recent
- Identify the moment of most significant shift using the writer's own language
- Be honest about instability — if the concept was contested in the writer's mind, say so
- Avoid framing change as progress; change is just change
- Use specific phrases from the entries above wherever they illuminate the arc

Write as if describing the evolution of a living idea, not a personal achievement.
""".strip()


def prompt_contradiction(concept_a: str, concept_b: str, entries_a: list, entries_b: list,
                         resolved: bool, resolution_note: str = None) -> str:
    block_a = _entry_block(entries_a, limit=3)
    block_b = _entry_block(entries_b, limit=3)
    resolution = (
        f"\nThis tension was eventually resolved: {resolution_note}" if resolved and resolution_note
        else "\nThis tension remains unresolved at the time of writing." if not resolved
        else ""
    )

    return f"""
Write a biographical section about a contradiction in the writer's thinking — approximately 160 words.

The tension: {concept_a} vs {concept_b}

Journal entries where {concept_a} surfaces:
{block_a}

Journal entries where {concept_b} surfaces:
{block_b}

{resolution}

The section should:
- Describe the nature of the tension using language from the actual entries
- Quote or closely paraphrase the most striking entry
- If resolved, describe the synthesis with precision — what did they actually conclude?
- If unresolved, end with the open question they are still living inside

Write as if this contradiction is the most interesting thing about this person.
""".strip()


def prompt_influences(people: list, sources: list, entries: list) -> str:
    people_str = "\n".join([
        f"- {p['name']} (first mentioned {(p.get('first_mentioned') or '')[:7]}, "
        f"introduced concepts: {', '.join(p.get('concepts', [])[:3])})"
        for p in people[:6]
    ])
    sources_str = "\n".join([
        f"- {s['title']} (around {(s.get('consumed_at') or '')[:7]}, "
        f"catalyzed: {', '.join(s.get('concepts', [])[:3])})"
        for s in sources[:6]
    ])
    entry_block = _entry_block(entries[:4])

    has_influences = bool(people_str or sources_str)

    if not has_influences:
        return f"""
Write a biographical section about intellectual formation — approximately 180 words.

No specific people or sources are recorded in the journal yet. Instead, write about
the internal influences visible in the writing itself — recurring ideas that seem to
come from somewhere, framings that suggest a particular tradition of thought.

Relevant journal entries:
{entry_block}

Describe the intellectual formation visible in the writing even without named influences.
""".strip()

    return f"""
Write a biographical section about intellectual influences — approximately 180 words.

People who shaped the writer's thinking:
{people_str if people_str else "None recorded yet."}

Books and sources that catalyzed concept shifts:
{sources_str if sources_str else "None recorded yet."}

Relevant journal entries:
{entry_block}

The section should:
- Name which arrival mattered most and what it unlocked in the thinking
- Use language from the entries to show the before/after of a key influence
- Resist hagiography — influences are catalysts, not authorities
- Note any surprising or counterintuitive influences

Write as a map of intellectual debt, honestly rendered.
""".strip()


def prompt_closing(open_questions: list, unstable_concepts: list, core_concepts: list, recent_entries: list) -> str:
    questions = "\n".join([f'- "{q}"' for q in open_questions[:5] if q])
    unstable = ", ".join([c["id"] for c in unstable_concepts[:4]])
    core = ", ".join([c["id"] for c in core_concepts[:5]])
    entry_block = _entry_block(recent_entries[:3])

    return f"""
Write the closing section of the biography — approximately 200 words.

The writer's most persistent open questions from their journal:
{questions if questions else "No explicit open questions recorded — infer from the entries below."}

Concepts still in active flux: {unstable if unstable else "not yet identified"}
Concepts that have remained central throughout: {core if core else "emerging"}

Most recent journal entries:
{entry_block}

The closing should:
- Name what the writer is still in the middle of — not what they have figured out
- Use their own language from recent entries to anchor the ending
- Be honest that a thought biography is always unfinished
- End with a single sentence or image that captures something essential about this mind
- Not be consoling or triumphant — be true

This is the last thing the person will read. Make it land.
""".strip()


def prompt_final_synthesis(opening: str, closing: str, all_sections_preview: str) -> str:
    return f"""
You have written an intellectual biography. Now revise the opening section only.

The closing you wrote ends with:
{closing[-600:] if closing else "[no closing yet]"}

A preview of what the full biography covers:
{all_sections_preview[:800]}

The original opening:
{opening}

Rewrite the opening (approximately 250 words) so that it:
- Foreshadows what will matter most without spoiling it
- Uses language or an image that resonates with the closing
- Creates the sense that the reader is entering a specific, particular mind — not a general one
- Makes someone want to keep reading

Return only the revised opening text, nothing else.
""".strip()


async def _stream_section(prompt: str, max_tokens: int = 500) -> AsyncGenerator[str, None]:
    """Stream a single section from Claude."""
    with claude.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        system=WRITER_SYSTEM,
        messages=[{"role": "user", "content": prompt}]
    ) as stream:
        for text in stream.text_stream:
            yield text


async def generate_biography(graph_data: dict) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Yields structured chunks as the biography is generated.
    Each chunk: { "section": str, "text": str, "status": str }
    Final chunk: { "section": "__complete__", "full_text": str, "sections": dict }
    """
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
    async for text in _stream_section(prompt_opening(graph_data), max_tokens=600):
        opening_text += text
        yield {"section": "opening", "text": text, "status": "streaming"}
    sections["opening"] = opening_text
    yield {"section": "opening", "text": "", "status": "complete"}

    # ── PASS 2: Era narratives ────────────────────────────────────────────────
    for i, era in enumerate(eras):
        era_entries = [e for e in entries if era.lower() in (e.get("life_context") or "").lower()]
        era_concepts = [
            e["target"] for e in edges
            if e.get("source") == era and e.get("type") == "CONTEXT"
        ]
        yield {"section": f"era_{era}", "text": "", "status": "generating"}
        era_text = ""
        prev_era = eras[i - 1] if i > 0 else None
        async for text in _stream_section(prompt_era(era, era_entries, era_concepts, prev_era), max_tokens=500):
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
        if not snapshots:
            continue

        # Get entries mentioning this concept
        concept_entries = [
            e for e in entries
            if label.lower() in (e.get("content") or e.get("summary") or "").lower()
        ]

        yield {"section": f"concept_{label}", "text": "", "status": "generating"}
        concept_text = ""
        async for text in _stream_section(
            prompt_concept_arc(label, snapshots, concept_entries), max_tokens=450
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
        # Get entries for each concept
        entries_a = [e for e in entries if c["concept_a"].lower() in (e.get("content") or "").lower()]
        entries_b = [e for e in entries if c["concept_b"].lower() in (e.get("content") or "").lower()]

        yield {"section": key, "text": "", "status": "generating"}
        contra_text = ""
        async for text in _stream_section(
            prompt_contradiction(
                c["concept_a"], c["concept_b"],
                entries_a, entries_b,
                c.get("resolved", False), c.get("resolution_note")
            ), max_tokens=400
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
        prompt_influences(people, sources, entries[:5]), max_tokens=450
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
        prompt_closing(open_questions, unstable_concepts, core_concepts, recent_entries), max_tokens=500
    ):
        closing_text += text
        yield {"section": "closing", "text": text, "status": "streaming"}
    sections["closing"] = closing_text
    yield {"section": "closing", "text": "", "status": "complete"}

    # ── PASS 7: Synthesis — rewrite opening with full context ─────────────────
    all_preview = " | ".join([k for k in sections.keys()])
    yield {"section": "opening_revised", "text": "", "status": "generating"}
    revised_opening = ""
    async for text in _stream_section(
        prompt_final_synthesis(opening_text, closing_text, all_preview), max_tokens=600
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
            parts.append(f"**{era_name}**\n\n{sections[key]}")

    concept_keys = [k for k in sections if k.startswith("concept_")]
    if concept_keys:
        parts.append("\n---\n")
        for key in concept_keys:
            concept_name = key.replace("concept_", "")
            parts.append(f"**On {concept_name}**\n\n{sections[key]}")

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
