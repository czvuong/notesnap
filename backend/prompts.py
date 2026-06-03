"""
prompts.py — All AI prompt templates and correction injection logic.

Keeping prompts in one place makes them easy to iterate on and test
independently from the rest of the app. Every prompt-building function
returns a plain string — no AI calls happen here.
"""

from typing import Optional


# ── Shared output format instruction ─────────────────────────────────────────
# Both modes return the same JSON schema so the rest of the app handles
# them identically regardless of which mode was used.

_JSON_SCHEMA = """
You MUST respond with ONLY a valid JSON object — no markdown fences, no
explanation, no text before or after the JSON. The schema is:

{
  "suggested_title": "<concise title for these notes, max 80 chars>",
  "confidence": "high" | "medium" | "low",
  "warnings": ["<any issues: illegible text, cut-off content, etc.>"],
  "sections": [
    {
      "heading": "<section heading as PLAIN TEXT — no ** or markdown markers — or null if none>",
      "content_type": "text" | "bullet_list" | "equation" | "diagram_description",
      "content": "<section content as a single string>",
      "section_order": <integer starting at 0>
    }
  ]
}

Content type rules:
- "text": plain prose paragraphs
- "bullet_list": items separated by newlines, each starting with "- "
- "equation": mathematical expressions; use plain text or LaTeX notation
- "diagram_description": describe any diagrams, charts, or drawings in text
- Mark any illegible word or phrase as [illegible]
- If the entire image is unreadable, return one section with content "[illegible]"
  and confidence "low"

Confidence and rejection rules — READ CAREFULLY:
- It is ALWAYS better to return nothing than to return fabricated or unreliable content.
- Return an EMPTY sections array (sections: []) with confidence "low" and a clear warning
  in ANY of these situations:
    • The image is blank or nearly blank with no visible text at all
    • The image is not academic content (outdoor scene, food, people, random unrelated objects)
    • The image is so severely overexposed or underexposed that no text is legible
    • The text is garbled, consists only of isolated characters, or makes no semantic sense
  Use this exact structure: {"suggested_title": "", "confidence": "low", "warnings": ["<specific reason>"], "sections": []}
- Add a WARNING (but still extract content) in these situations:
    • More than 20 sections in a single image — likely indicates extraction noise or hallucination
    • Content is primarily visual diagram notation: arrows (→, ←, ↑↓), node labels, tree or
      graph structures — warn that visual structure may not be fully captured as text
    • Significant portions of the image are illegible alongside legible areas
- Use confidence "medium" if some content is legible but significant portions are unclear.
- Use confidence "high" only when the content is clearly academic and fully legible.
- NOTE: Dense cheatsheets, structured notes, and repeated headings are NOT reasons to
  reject — those are valid academic formats. Only reject truly unreadable or non-academic content.

Formatting rules:
- Heading values MUST be plain text — never wrap them in ** or any markdown
- SKIP lines that are just isolated numbers, page numbers, slide counters, or
  single characters that are clearly navigation/layout artifacts, not content
- Do NOT include table-of-contents numbers, slide indices, or footer/header noise
"""


# ── Correction injection ──────────────────────────────────────────────────────

def build_correction_block(corrections: list[dict]) -> str:
    """
    Given a list of active corrections (dicts with keys: original_text,
    corrected_text, correction_type, context_hint), return a prompt block
    that instructs the AI to apply them.

    Returns an empty string if there are no corrections.
    """
    if not corrections:
        return ""

    lines = [
        "\n--- USER PREFERENCES FROM PAST CORRECTIONS ---",
        "The user has previously corrected these issues. Apply them consistently:\n",
    ]

    for c in corrections:
        hint = f" ({c['context_hint']})" if c.get("context_hint") else ""
        ctype = c.get("correction_type", "content")

        if ctype == "spelling":
            lines.append(f'- Spelling: always write "{c["corrected_text"]}", not "{c["original_text"]}"{hint}')
        elif ctype == "terminology":
            lines.append(f'- Terminology: prefer "{c["corrected_text"]}" over "{c["original_text"]}"{hint}')
        elif ctype == "formatting":
            lines.append(f'- Formatting preference: {c["corrected_text"]}{hint}')
        elif ctype == "section_rename":
            lines.append(f'- Section naming: use "{c["corrected_text"]}" instead of "{c["original_text"]}"{hint}')
        else:
            lines.append(f'- Content correction: "{c["original_text"]}" → "{c["corrected_text"]}"{hint}')

    lines.append("--- END USER PREFERENCES ---\n")
    return "\n".join(lines)


def build_preference_block(prefs: Optional[dict]) -> str:
    """
    Translate stored user preferences into prompt instructions.
    """
    if not prefs:
        return ""

    parts = []
    heading_style = prefs.get("preferred_heading_style", "bold")
    bullet_style  = prefs.get("preferred_bullet_style", "dash")
    extra         = prefs.get("extra_instructions", "")

    if heading_style == "bold":
        parts.append("Emphasise section headings (but still write them as plain text in the heading field — no ** markers).")
    elif heading_style == "numbered":
        parts.append("Use numbered headings (1., 2., 3.) for all sections.")
    elif heading_style == "plain":
        parts.append("Use plain unformatted text for section headings.")

    if bullet_style == "dash":
        parts.append("Use dashes (-) for all bullet points.")
    elif bullet_style == "dot":
        parts.append("Use dots (•) for all bullet points.")
    elif bullet_style == "arrow":
        parts.append("Use arrows (→) for all bullet points.")

    if extra:
        parts.append(f"Additional user instruction: {extra}")

    if not parts:
        return ""

    return "\n--- USER STYLE PREFERENCES ---\n" + "\n".join(parts) + "\n--- END STYLE PREFERENCES ---\n"


# ── Transcribe mode ───────────────────────────────────────────────────────────

def build_transcription_prompt(
    corrections: list[dict] | None = None,
    prefs: dict | None = None,
) -> str:
    """
    Prompt for 'Transcribe Exactly' mode.
    Goal: faithful reproduction of what is written, preserving structure.
    """
    correction_block = build_correction_block(corrections or [])
    pref_block       = build_preference_block(prefs)

    return f"""You are a precise document transcription assistant.

Your job is to transcribe the content of the provided image as faithfully as
possible. Preserve the original structure: headings, bullet points, numbered
lists, equations, and spacing hierarchy.

Rules:
- Do NOT interpret, explain, or add information that is not in the image.
- Do NOT fix errors unless specified in user preferences below.
- Preserve mathematical notation as closely as possible.
- If you see a diagram or drawing, describe it briefly in a "diagram_description" section.
- Split content into logical sections based on visual separation or headings.
- If a word is ambiguous (e.g. a letter could be "u" or "v"), transcribe your
  best guess and add a warning.
{correction_block}{pref_block}{_JSON_SCHEMA}"""


# ── Study guide mode ──────────────────────────────────────────────────────────

def build_study_guide_prompt(
    corrections: list[dict] | None = None,
    prefs: dict | None = None,
) -> str:
    """
    Prompt for 'Generate Study Guide' mode.
    Goal: clean, organized study notes with key concepts surfaced.
    """
    correction_block = build_correction_block(corrections or [])
    pref_block       = build_preference_block(prefs)

    return f"""You are an expert academic note-taking assistant.

Your job is to transform the content of the provided image into clean,
well-organized study notes. Extract and structure the key concepts.

FIRST — check if the content is worth processing:
- If the extracted text is blank, empty, or contains fewer than ~15 meaningful
  words (e.g. only noise, isolated characters, or a single word), return empty
  sections with confidence "low". Do NOT generate placeholder titles or invent
  study notes from nothing.
- Apply all rejection rules from the schema below before generating any content.

Rules:
- Identify the main topic and give the notes a clear, descriptive title.
- Organize content into logical sections with clear headings.
- For each key term or concept, write a clear explanation sentence — not just a
  label. State what it is, how it works, or why it matters. Example:
  "The kernel trick is a method that…" or "Contrastive learning trains a model
  by…". Do not list terms without explaining them.
- Convert dense paragraphs into concise bullet points where appropriate, but
  always lead with a definition or explanation sentence for new concepts.
- Preserve all equations and formulas exactly as written.
- Add a "Key Concepts" or "Overview" section summarizing the most important
  terms and ideas.
- If you see examples, clearly label them as such.
- Do NOT invent content that is not in the image — only reorganize and clarify.
{correction_block}{pref_block}{_JSON_SCHEMA}"""


# ── Flashcard generation ──────────────────────────────────────────────────────

def build_flashcard_prompt(sections_text: str) -> str:
    """
    Given the text content of a note's sections, generate flashcards.
    """
    return f"""You are a study assistant creating flashcards from lecture notes.

Given the following notes, generate flashcards covering the key terms,
concepts, and facts. Each flashcard should test one specific thing.

Notes:
{sections_text}

Respond with ONLY a valid JSON array — no markdown, no explanation:
[
  {{
    "front": "<question or term>",
    "back": "<answer or definition>"
  }}
]

Guidelines:
- Aim for 5–15 cards per set of notes.
- Front side: a question ("What is...?", "Define...", "What does X do?")
  or a term to define.
- Back side: a concise, accurate answer (1–3 sentences max).
- Do not make cards for trivial or obvious facts.
- For equations, put the equation name on the front and the formula on the back."""


# ── Practice question generation ──────────────────────────────────────────────

def build_practice_questions_prompt(sections_text: str) -> str:
    """
    Given the text content of a note's sections, generate practice questions.
    """
    return f"""You are a professor creating a practice quiz from lecture notes.

Given the following notes, generate a mix of short-answer and multiple-choice
questions that test understanding (not just recall).

Notes:
{sections_text}

Respond with ONLY a valid JSON array — no markdown, no explanation:
[
  {{
    "question_text": "<the question>",
    "answer_text": "<the correct answer, 1–3 sentences>",
    "question_type": "short_answer" | "multiple_choice",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."] or null
  }}
]

Guidelines:
- Generate 4–8 questions.
- Mix short_answer and multiple_choice.
- For multiple_choice, include 4 options and make sure only one is clearly correct.
- Options field should be null for short_answer questions.
- Questions should require understanding, not just memorization."""


# ── Course summary generation ─────────────────────────────────────────────────

def build_course_summary_prompt(all_notes_text: str, course_name: str) -> str:
    """
    Given the combined text of all notes in a course, generate a short overview.
    """
    return f"""You are a study assistant writing a brief course overview.

Based on the following notes from the course "{course_name}", write a short
"about this course" description — 2 to 4 sentences, 50–80 words. It should
explain what the course covers at a high level, as if introducing it to a
new student. Do NOT list exam topics, formulas, or bullet points. Write in
plain prose only.

Notes:
{all_notes_text}

Respond with only the plain text overview. No headings, no bullets, no markdown."""
