"""
biography_generator.py — Thought Biography Document Generator
--------------------------------------------------------------
Multi-pass Claude pipeline that reads your graph and generates
a literary intellectual memoir in structured sections.

The document has 6 sections, each generated independently
then synthesized into a coherent whole:

  1. Opening         — Who you were becoming, framed by the reader
  2. Era narratives  — Each life period's dominant preoccupations
  3. Concept arcs    — The story of your core concepts' evolution
  4. Contradictions  — The tensions you've carried and how they resolved
  5. Influences      — Which books and people arrived when, and what they unlocked
  6. Closing         — The open questions you're still living inside

Usage:
    from biography_generator import generate_biography
    async for chunk in generate_biography(user_graph_data):
        print(chunk, end="", flush=True)
"""

import os
import json
import asyncio
from typing import AsyncGenerator, Dict, Any
from dotenv import load_dotenv
import anthropic

load_dotenv()

claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# ── System prompt: the writer's voice ────────────────────────────────────────
WRITER_SYSTEM = """
You are a literary biographer specialising in intellectual and philosophical memoir.
You write in the tradition of serious personal essays — precise, honest, and humane.
Your prose is elegant but never ornate. You do not flatter. You do not psychoanalyse.
You describe the arc of thought as it actually happened, including the false starts,
the contradictions held in tension, the slow shifts that only become visible in retrospect.

You write in third person: "they", "the writer", or use the concept/idea as subject.
Never "you" or "I". Never "the user".

Avoid:
- Clichés about "journeys" or "growth"
- Psychological jargon
- Generic wisdom or life-advice framing
- Summarising what the reader can already see
- Excessive hedging ("it seems", "perhaps", "one might say")

Write as if this document will be printed and given to the person as a gift.
It should be something they will want to re-read.
""".strip()

# ── Section prompts ───────────────────────────────────────────────────────────

def prompt_opening(graph_data: Dict) -> str:
    core_concepts = [n["id"] for n in graph_data["nodes"] if n.get("core") and n.get("type") == "concept"][:5]
    eras = [n["id"] for n in graph_data["nodes"] if n.get("type") == "era"]
    total_entries = graph_data.get("stats", {}).get("entries", "many")
    contradictions = [(e["source"], e["target"]) for e in graph_data["edges"] if e["type"] == "CONTRADICTS"][:3]

    return f"""
Write the opening section of an intellectual biography — approximately 250 words.

This person has kept a thought journal across {len(eras)} periods of their life: {", ".join(eras)}.
Their thinking has circled most persistently around: {", ".join(core_concepts)}.
Running through their thinking are these unresolved tensions: {", ".join([f"{a} vs {b}" for a, b in contradictions])}.

The opening should:
- Set the scene of a mind in motion, without being melodramatic
- Name what's distinctive about how this person thinks (based on the concepts)
- End with a sentence that orients the reader toward what the biography will trace

Do not list facts. Write in flowing prose. Make it feel like the first page of a book worth reading.
""".strip()


def prompt_era(era_name: str, concepts: list, entries_summary: list, prev_era: str = None) -> str:
    concept_names = [c["concept"] for c in sorted(concepts, key=lambda x: -x["weight"])[:6]]
    snippets = "\n".join([f'- "{s}"' for s in entries_summary[:5] if s])

    prev_line = f"This follows the {prev_era} period." if prev_era else "This is the earliest recorded period."

    return f"""
Write a biographical section about the {era_name} period — approximately 200 words.
{prev_line}

The dominant concepts during this period were: {", ".join(concept_names)}

Representative entry fragments from this period:
{snippets if snippets else "No specific fragments available — infer from the concepts."}

The section should:
- Describe what the writer was preoccupied with and why it mattered to them then
- Note which ideas were forming, which were stable, which were unstable
- End with a sense of what was about to change or what question was forming

Write in flowing prose. Do not use bullet points.
""".strip()


def prompt_concept_arc(label: str, snapshots: list, influences: list) -> str:
    timeline = "\n".join([
        f"- {s['date'][:7]} ({s['era']}): {s['definition']}"
        for s in snapshots
    ])
    influence_names = [i["person_or_source"] for i in influences[:3] if i.get("person_or_source")]

    return f"""
Write a biographical section tracing the evolution of one concept — approximately 180 words.

Concept: {label}
{"Influenced by: " + ", ".join(influence_names) if influence_names else ""}

Definition timeline:
{timeline}

The section should:
- Trace the arc from the earliest definition to the most recent
- Name the moment of most significant shift and what caused it
- Be honest about instability — if the concept was contested in the writer's mind, say so
- Avoid framing change as progress; change is just change

Write as if describing the evolution of a living idea, not a personal achievement.
""".strip()


def prompt_contradiction(concept_a: str, concept_b: str, snippets: list,
                          resolved: bool, resolution_note: str = None) -> str:
    snip_text = "\n".join([f'- ({s["date"][:7]}, on {s["concept"]}): "{s["text"]}"'
                           for s in snippets[:4] if s.get("text")])
    resolution = f"\nThis tension was eventually resolved: {resolution_note}" if resolved and resolution_note else \
                 "\nThis tension remains unresolved." if not resolved else ""

    return f"""
Write a biographical section about a contradiction in the writer's thinking — approximately 160 words.

The tension: {concept_a} vs {concept_b}

Entry fragments where this tension is visible:
{snip_text if snip_text else "No fragments available — describe the structural tension between these ideas."}
{resolution}

The section should:
- Describe the nature of the tension without resolving it artificially
- Quote or closely paraphrase the most striking entry fragment
- If resolved, describe the synthesis with precision — what did they actually conclude?
- If unresolved, end with the open question they're still living inside

Write as if this contradiction is the most interesting thing about the person.
""".strip()


def prompt_influences(people: list, sources: list) -> str:
    people_str = "\n".join([f"- {p['name']} (first mentioned {p.get('first_mentioned','?')[:7] if p.get('first_mentioned') else '?'}, "
                             f"introduced concepts: {', '.join(p.get('concepts',[])[:3])})"
                             for p in people[:6]])
    sources_str = "\n".join([f"- {s['title']} (read around {s.get('consumed_at','?')[:7] if s.get('consumed_at') else '?'}, "
                              f"catalyzed: {', '.join(s.get('concepts',[])[:3])})"
                              for s in sources[:6]])

    return f"""
Write a biographical section about intellectual influences — approximately 180 words.

People who shaped the writer's thinking:
{people_str if people_str else "No specific people recorded."}

Books and sources that catalyzed concept shifts:
{sources_str if sources_str else "No specific sources recorded."}

The section should:
- Name which arrival mattered most and why
- Describe what became possible in the thinking after a key influence appeared
- Resist the hagiographic impulse — influences are catalysts, not authorities
- Note any surprising or counterintuitive influences

Write as a map of intellectual debt, honestly rendered.
""".strip()


def prompt_closing(open_questions: list, unstable_concepts: list, core_concepts: list) -> str:
    questions = "\n".join([f'- "{q}"' for q in open_questions[:5] if q])
    unstable = ", ".join([c["id"] for c in unstable_concepts[:4]])
    core = ", ".join([c["id"] for c in core_concepts[:5]])

    return f"""
Write the closing section of the biography — approximately 200 words.

The writer's most persistent open questions:
{questions if questions else "No explicit open questions recorded."}

Concepts still in active flux: {unstable if unstable else "none identified"}
Core concepts that have remained central throughout: {core}

The closing should:
- Name what the writer is still in the middle of — not what they've figured out
- Be honest that a thought biography is always unfinished
- End with a single sentence or image that captures something essential about this mind
- Not be consoling or triumphant — be true

This is the last thing the person will read. Make it land.
""".strip()


def prompt_final_synthesis(sections: Dict[str, str], graph_data: Dict) -> str:
    section_texts = "\n\n---\n\n".join([
        f"[{k.upper()}]\n{v}" for k, v in sections.items()
    ])
    return f"""
You have written six sections of an intellectual biography. Now revise the opening section only.

Here are all the sections you wrote:
{section_texts}

Having written the full arc, rewrite the opening (first section) so that it:
- Foreshadows what will matter most without spoiling it
- Uses an image or observation from the later sections to anchor the opening
- Creates a sense that the reader is entering a specific, particular mind — not a general one
- Is approximately 250 words

Return only the revised opening text, nothing else.
""".strip()


# ── Main generator ────────────────────────────────────────────────────────────

async def generate_biography(graph_data: Dict) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Yields structured chunks as the biography is generated.
    Each chunk: { "section": str, "text": str, "done": bool }

    graph_data shape:
    {
      "nodes": [...],
      "edges": [...],
      "stats": { "entries": int, ... },
      "concept_histories": { "Freedom": { "snapshots": [...], "color": "..." }, ... },
      "contradictions": [...],
      "entries": [{ "summary": str, "created_at": str, "open_question": str }, ...],
      "people": [{ "name": str, "first_mentioned": str, "concepts": [...] }, ...],
      "sources": [{ "title": str, "consumed_at": str, "concepts": [...] }, ...],
    }
    """

    sections = {}
    nodes = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])
    entries = graph_data.get("entries", [])
    contradictions_data = graph_data.get("contradictions", [])

    core_concepts = [n for n in nodes if n.get("core") and n.get("type") == "concept"]
    unstable_concepts = [n for n in nodes if n.get("type") == "concept" and (n.get("stability") or 1) < 0.6]
    eras = [n["id"] for n in nodes if n.get("type") == "era"]

    open_questions = [e.get("open_question") for e in entries if e.get("open_question")]

    # ── PASS 1: Opening ──────────────────────────────────────────────────────
    yield {"section": "opening", "text": "", "status": "generating"}

    opening_text = ""
    with claude.messages.stream(
        model="claude-opus-4-6",
        max_tokens=600,
        system=WRITER_SYSTEM,
        messages=[{"role": "user", "content": prompt_opening(graph_data)}]
    ) as stream:
        for text in stream.text_stream:
            opening_text += text
            yield {"section": "opening", "text": text, "status": "streaming"}

    sections["opening"] = opening_text
    yield {"section": "opening", "text": "", "status": "complete"}

    # ── PASS 2: Era narratives ────────────────────────────────────────────────
    for i, era in enumerate(eras):
        era_concepts = []
        for e in edges:
            if e.get("source") == era and e.get("type") == "CONTEXT":
                weight = e.get("strength", 0.5)
                era_concepts.append({"concept": e.get("target"), "weight": weight})

        era_entries = [e.get("summary", "") for e in entries
                       if era.lower() in (e.get("life_context") or "").lower()]

        yield {"section": f"era_{era}", "text": "", "status": "generating"}

        era_text = ""
        prev_era = eras[i - 1] if i > 0 else None
        with claude.messages.stream(
            model="claude-opus-4-6",
            max_tokens=500,
            system=WRITER_SYSTEM,
            messages=[{"role": "user", "content": prompt_era(era, era_concepts, era_entries, prev_era)}]
        ) as stream:
            for text in stream.text_stream:
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

        influences = []
        for e in edges:
            if e.get("target") == label and e.get("type") in ("INTRODUCED", "CATALYZED"):
                influences.append({"person_or_source": e.get("source")})

        yield {"section": f"concept_{label}", "text": "", "status": "generating"}

        concept_text = ""
        with claude.messages.stream(
            model="claude-opus-4-6",
            max_tokens=450,
            system=WRITER_SYSTEM,
            messages=[{"role": "user", "content": prompt_concept_arc(label, snapshots, influences)}]
        ) as stream:
            for text in stream.text_stream:
                concept_text += text
                yield {"section": f"concept_{label}", "text": text, "status": "streaming"}

        sections[f"concept_{label}"] = concept_text
        yield {"section": f"concept_{label}", "text": "", "status": "complete"}

    # ── PASS 4: Contradictions ────────────────────────────────────────────────
    major_contradictions = sorted(
        contradictions_data,
        key=lambda c: c.get("tension_score", 0),
        reverse=True
    )[:4]

    for c in major_contradictions:
        key = f"contradiction_{c['concept_a']}_{c['concept_b']}"
        yield {"section": key, "text": "", "status": "generating"}

        contra_text = ""
        with claude.messages.stream(
            model="claude-opus-4-6",
            max_tokens=400,
            system=WRITER_SYSTEM,
            messages=[{"role": "user", "content": prompt_contradiction(
                c["concept_a"], c["concept_b"],
                c.get("entry_snippets", []),
                c.get("resolved", False),
                c.get("resolution_note")
            )}]
        ) as stream:
            for text in stream.text_stream:
                contra_text += text
                yield {"section": key, "text": text, "status": "streaming"}

        sections[key] = contra_text
        yield {"section": key, "text": "", "status": "complete"}

    # ── PASS 5: Influences ────────────────────────────────────────────────────
    people = graph_data.get("people", [])
    sources = graph_data.get("sources", [])

    if people or sources:
        yield {"section": "influences", "text": "", "status": "generating"}

        influence_text = ""
        with claude.messages.stream(
            model="claude-opus-4-6",
            max_tokens=450,
            system=WRITER_SYSTEM,
            messages=[{"role": "user", "content": prompt_influences(people, sources)}]
        ) as stream:
            for text in stream.text_stream:
                influence_text += text
                yield {"section": "influences", "text": text, "status": "streaming"}

        sections["influences"] = influence_text
        yield {"section": "influences", "text": "", "status": "complete"}

    # ── PASS 6: Closing ───────────────────────────────────────────────────────
    yield {"section": "closing", "text": "", "status": "generating"}

    closing_text = ""
    with claude.messages.stream(
        model="claude-opus-4-6",
        max_tokens=500,
        system=WRITER_SYSTEM,
        messages=[{"role": "user", "content": prompt_closing(
            open_questions, unstable_concepts, core_concepts
        )}]
    ) as stream:
        for text in stream.text_stream:
            closing_text += text
            yield {"section": "closing", "text": text, "status": "streaming"}

    sections["closing"] = closing_text
    yield {"section": "closing", "text": "", "status": "complete"}

    # ── PASS 7: Synthesis — rewrite opening with full context ─────────────────
    yield {"section": "opening_revised", "text": "", "status": "generating"}

    revised_opening = ""
    with claude.messages.stream(
        model="claude-opus-4-6",
        max_tokens=600,
        system=WRITER_SYSTEM,
        messages=[{"role": "user", "content": prompt_final_synthesis(sections, graph_data)}]
    ) as stream:
        for text in stream.text_stream:
            revised_opening += text
            yield {"section": "opening_revised", "text": text, "status": "streaming"}

    sections["opening"] = revised_opening
    yield {"section": "opening_revised", "text": "", "status": "complete"}

    # ── Done — emit full assembled document ───────────────────────────────────
    yield {
        "section": "__complete__",
        "text": "",
        "status": "done",
        "sections": sections,
        "full_text": assemble_document(sections),
    }


def assemble_document(sections: Dict[str, str]) -> str:
    """Assemble sections into a readable markdown document."""
    parts = []

    if sections.get("opening"):
        parts.append(sections["opening"])

    # Era sections
    era_keys = [k for k in sections if k.startswith("era_")]
    if era_keys:
        parts.append("\n---\n")
        for key in era_keys:
            era_name = key.replace("era_", "")
            parts.append(f"**{era_name}**\n\n{sections[key]}")

    # Concept arcs
    concept_keys = [k for k in sections if k.startswith("concept_")]
    if concept_keys:
        parts.append("\n---\n")
        for key in concept_keys:
            concept_name = key.replace("concept_", "")
            parts.append(f"**On {concept_name}**\n\n{sections[key]}")

    # Contradictions
    contra_keys = [k for k in sections if k.startswith("contradiction_")]
    if contra_keys:
        parts.append("\n---\n")
        for key in contra_keys:
            parts.append(sections[key])

    # Influences
    if sections.get("influences"):
        parts.append("\n---\n")
        parts.append(sections["influences"])

    # Closing
    if sections.get("closing"):
        parts.append("\n---\n")
        parts.append(sections["closing"])

    return "\n\n".join(parts)
