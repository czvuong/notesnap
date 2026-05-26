"""
extraction.py — AI extraction pipeline.

This module is intentionally self-contained:
  - No FastAPI imports
  - No database imports
  - Can be run directly from the CLI or imported by the test harness

The only external dependencies are the AI client libraries and prompts.py.

Main public interface:
    extract_note(image_bytes, mode, corrections, prefs) -> ExtractionResult
"""

import base64
import json
import logging
import re
from io import BytesIO
from typing import Optional

from PIL import Image

from config import settings
from prompts import build_transcription_prompt, build_study_guide_prompt
from schemas import ExtractionResult, ExtractedSection

logger = logging.getLogger(__name__)


# ── Image pre-processing ──────────────────────────────────────────────────────

MAX_DIMENSION = 2048   # pixels — models don't benefit from larger
JPEG_QUALITY  = 85     # balance between quality and token cost

def _prepare_image(image_bytes: bytes) -> tuple[str, str]:
    """
    Validate, resize if needed, and base64-encode a file for the AI API.

    PDFs are passed through as-is — api-lightonocr-1 accepts them natively
    and there is nothing for Pillow to resize or convert.

    Returns:
        (base64_string, mime_type)  e.g. ("...", "image/jpeg") or ("...", "application/pdf")

    Raises:
        ValueError: if the file is not a valid image or PDF
    """
    # ── PDF fast-path ─────────────────────────────────────────────────────────
    # Detect by magic bytes (more reliable than Content-Type header).
    # Search first 1024 bytes to handle PDFs with a BOM or whitespace prefix.
    if b"%PDF" in image_bytes[:1024]:
        logger.debug("Input is a PDF (%d bytes) — skipping Pillow, passing to OCR as-is", len(image_bytes))
        return base64.b64encode(image_bytes).decode("utf-8"), "application/pdf"

    # ── Image path ────────────────────────────────────────────────────────────
    try:
        img = Image.open(BytesIO(image_bytes))
    except Exception as e:
        raise ValueError(f"Could not open image: {e}") from e

    # Convert HEIC / TIFF / other formats to JPEG for broad API support
    if img.format not in ("JPEG", "PNG", "GIF", "WEBP"):
        img = img.convert("RGB")
        output_format = "JPEG"
        mime_type = "image/jpeg"
    else:
        output_format = img.format
        mime_type = f"image/{img.format.lower()}"

    # Resize if either dimension exceeds MAX_DIMENSION
    w, h = img.size
    if w > MAX_DIMENSION or h > MAX_DIMENSION:
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)
        logger.debug("Resized image from (%d, %d) to %s", w, h, img.size)

    buf = BytesIO()
    save_kwargs = {"quality": JPEG_QUALITY} if output_format == "JPEG" else {}
    img.save(buf, format=output_format, **save_kwargs)
    buf.seek(0)

    return base64.b64encode(buf.read()).decode("utf-8"), mime_type


# ── PDF text extraction ────────────────────────────────────────────────────────

def _extract_pdf_text(pdf_bytes: bytes) -> str | None:
    """
    Try to extract embedded text from a PDF using pypdf.

    The import is done here (not at module level) so that:
    - A freshly-installed pypdf is picked up without restarting Python.
    - The real ImportError message is surfaced to the caller.

    Returns the extracted text if at least 100 characters are found
    (indicating a text-based PDF), otherwise returns None (indicating a
    scanned/image-only PDF that needs the vision model instead).

    Raises:
        RuntimeError: if pypdf is not installed, with install instructions.
    """
    try:
        from pypdf import PdfReader as _PdfReader  # deferred import
    except ImportError as exc:
        raise RuntimeError(
            "PDF support requires the pypdf package. "
            "Run:  pip install pypdf --break-system-packages  "
            "then restart the backend server."
        ) from exc

    try:
        reader = _PdfReader(BytesIO(pdf_bytes))
        pages_text = []
        for page in reader.pages:
            text = page.extract_text() or ""
            pages_text.append(text)
        full_text = "\n\n".join(pages_text).strip()
        # Strip control characters that PDF fonts sometimes embed (e.g. ligatures
        # encoded as private-use codepoints, null bytes, form feeds).
        # Keep \n, \r, \t — strip everything else in 0x00-0x1F range.
        full_text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", full_text)
        # Remove lines that are clearly layout noise: slide counters, page numbers,
        # TOC indices (lines consisting only of digits, spaces, or common separators).
        cleaned_lines = []
        for line in full_text.splitlines():
            stripped = line.strip()
            # Keep empty lines (preserve paragraph breaks)
            if not stripped:
                cleaned_lines.append(line)
                continue
            # Drop lines that are purely numeric / numeric with dots (e.g. "42", "1 2 3", "0 21 43 5")
            if re.fullmatch(r"[\d\s.]+", stripped):
                continue
            cleaned_lines.append(line)
        full_text = "\n".join(cleaned_lines)
        if len(full_text) < 100:
            logger.debug("PDF text extraction yielded <100 chars — likely a scanned PDF")
            return None
        logger.debug("PDF text extraction: %d chars from %d pages", len(full_text), len(reader.pages))
        return full_text
    except RuntimeError:
        raise  # re-raise the ImportError wrapper above
    except Exception as e:
        logger.warning("pypdf extraction failed: %s", e)
        return None


# ── Response parsing ──────────────────────────────────────────────────────────

def _parse_ai_response(raw_text: str, mode: str, model: str) -> ExtractionResult:
    """
    Parse the raw string response from the AI into an ExtractionResult.

    Handles common failure modes:
      - JSON wrapped in markdown fences (```json ... ```)
      - Leading/trailing whitespace
      - Missing optional fields
    """
    # Strip markdown fences if the model ignored our instructions
    text = raw_text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    # Sanitize literal control characters that PDF text often introduces.
    # JSON strings cannot contain raw 0x00–0x1F bytes (they must be \-escaped).
    # Replace them with a space, except for \n/\r/\t which are harmless in most contexts.
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        logger.error("AI returned non-JSON response: %s", raw_text[:500])
        # Return a low-confidence fallback rather than crashing the request
        return ExtractionResult(
            suggested_title="Untitled Notes",
            extraction_mode=mode,
            ai_model_used=model,
            sections=[ExtractedSection(
                heading="Raw Content",
                content_type="text",
                content=raw_text,
                section_order=0,
            )],
            confidence="low",
            warnings=[f"AI returned unparseable response: {e}"],
        )

    # Build sections, skipping any that are missing required fields
    sections = []
    for i, s in enumerate(data.get("sections", [])):
        if not s.get("content"):
            continue
        sections.append(ExtractedSection(
            heading=s.get("heading"),
            content_type=s.get("content_type", "text"),
            content=s["content"],
            section_order=s.get("section_order", i),
        ))

    if not sections:
        sections = [ExtractedSection(
            heading=None,
            content_type="text",
            content="[No content extracted]",
            section_order=0,
        )]

    return ExtractionResult(
        suggested_title=data.get("suggested_title", "Untitled Notes"),
        extraction_mode=mode,
        ai_model_used=model,
        sections=sections,
        confidence=data.get("confidence", "medium"),
        warnings=data.get("warnings", []),
    )


# ── AI client factory ─────────────────────────────────────────────────────────

def _get_openai_client():
    """Return an OpenAI-compatible client (used for TritonAI)."""
    from openai import OpenAI
    return OpenAI(
        api_key=settings.TRITONAI_API_KEY,
        base_url=settings.TRITONAI_BASE_URL,
    )

def _get_anthropic_client():
    """Return an Anthropic client."""
    from anthropic import Anthropic
    return Anthropic(api_key=settings.ANTHROPIC_API_KEY)


# ── Core extraction ───────────────────────────────────────────────────────────

def extract_note(
    image_bytes: bytes,
    mode: str = "transcribe",
    corrections: list[dict] | None = None,
    prefs: dict | None = None,
) -> ExtractionResult:
    """
    Send an image to the configured AI provider and return structured notes.

    TritonAI path — two-step pipeline (recommended):
      1. api-lightonocr-1  →  raw OCR text   (free on input)
      2. api-gpt-oss-120b  →  structured JSON (cheap + strong)

    Anthropic path — single-step vision (fallback):
      1. Claude vision model  →  structured JSON directly

    The image bytes are used only within this function and are never
    written to disk or stored anywhere.

    Args:
        image_bytes:  Raw bytes of the uploaded image file.
        mode:         "transcribe" or "study_guide".
        corrections:  List of active correction dicts from the database.
        prefs:        User preferences dict from the database.

    Returns:
        ExtractionResult with sections, title, confidence, and warnings.

    Raises:
        ValueError:   If the image cannot be processed.
        RuntimeError: If the AI API call fails.
    """
    if mode not in ("transcribe", "study_guide"):
        raise ValueError(f"Invalid mode: {mode!r}. Must be 'transcribe' or 'study_guide'.")

    # Step 1: prepare image/file
    b64_image, mime_type = _prepare_image(image_bytes)
    is_pdf = mime_type == "application/pdf"

    # Step 2: build structuring prompt
    if mode == "transcribe":
        system_prompt = build_transcription_prompt(corrections, prefs)
    else:
        system_prompt = build_study_guide_prompt(corrections, prefs)

    # Step 3: call AI (provider-specific paths)
    provider = settings.AI_PROVIDER.lower()

    if provider == "tritonai":

        # ── PDF path ─────────────────────────────────────────────────────────
        # Neither the OCR model nor vision models accept application/pdf data
        # URLs (they expect image/* formats). The only reliable path for PDFs
        # is extracting embedded text with pypdf.
        #
        # Scanned PDFs (no embedded text) cannot be processed without converting
        # pages to images first, which requires poppler/ghostscript. Those are
        # out of scope here — tell the user to screenshot/export as image instead.
        if is_pdf:
            pdf_text = _extract_pdf_text(image_bytes)
            if pdf_text:
                logger.info("PDF has embedded text (%d chars) — using text model directly", len(pdf_text))
                raw_json = _call_text_model(pdf_text, system_prompt)
                model_name = f"pypdf + {settings.TRITONAI_TEXT_MODEL}"
            else:
                # _extract_pdf_text returned None → PDF has no embedded text
                raise RuntimeError(
                    "This PDF appears to be scanned (no embedded text). "
                    "Please export it as a PNG/JPEG image and upload that instead."
                )

        else:
            # ── Image two-step pipeline ──────────────────────────────────────
            # Step 3a: OCR — image → raw text (free)
            # Falls back to single-step vision if OCR model is unavailable (403/404).
            logger.info("TritonAI OCR step: model=%s", settings.TRITONAI_OCR_MODEL)
            try:
                from openai import PermissionDeniedError, NotFoundError
                raw_text = _call_ocr_model(b64_image, mime_type)
                logger.debug("OCR output (%d chars): %s…", len(raw_text), raw_text[:200])
                ocr_used = True
            except (PermissionDeniedError, NotFoundError) as e:
                logger.warning(
                    "OCR model %r unavailable (%s) — falling back to single-step vision via %s",
                    settings.TRITONAI_OCR_MODEL, e.__class__.__name__, settings.TRITONAI_VISION_MODEL,
                )
                raw_text = None
                ocr_used = False

            # Step 3b: Structure
            logger.info("TritonAI structure step: model=%s", settings.TRITONAI_TEXT_MODEL)
            if ocr_used:
                raw_json = _call_text_model(raw_text, system_prompt)
                model_name = f"{settings.TRITONAI_OCR_MODEL} + {settings.TRITONAI_TEXT_MODEL}"
            else:
                raw_json = _call_vision_text_model(b64_image, mime_type, system_prompt)
                model_name = settings.TRITONAI_VISION_MODEL

    elif provider == "anthropic":
        # Single-step vision: image → JSON directly (Claude handles both in one call)
        raw_json = _call_anthropic(b64_image, mime_type, system_prompt)
        model_name = settings.ANTHROPIC_MODEL

    else:
        raise RuntimeError(f"Unknown AI_PROVIDER: {provider!r}")

    # Step 4: parse and return
    return _parse_ai_response(raw_json, mode, model_name)


def _call_ocr_model(b64_image: str, mime_type: str) -> str:
    """
    Step 1 of the TritonAI pipeline.

    Sends the image to api-lightonocr-1 for raw text extraction.
    This model is FREE on input — it does not charge for image tokens.
    The output is unstructured text; structuring happens in _call_text_model.
    """
    client = _get_openai_client()
    response = client.chat.completions.create(
        model=settings.TRITONAI_OCR_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{b64_image}",
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "Extract ALL text visible in this image. "
                            "Include headings, body text, equations, labels, and handwriting. "
                            "Preserve the document's structure (headings before body, "
                            "bullet points as separate lines). "
                            "Do not summarise or interpret — output the raw content only."
                        ),
                    },
                ],
            },
        ],
        max_tokens=4096,
        # Note: temperature omitted — some OCR-specialised models reject it
    )
    return response.choices[0].message.content or ""


def _call_text_model(raw_text: str, system_prompt: str) -> str:
    """
    Step 2 of the TritonAI pipeline.

    Takes the OCR-extracted text and structures it into JSON using
    api-gpt-oss-120b. No image token cost at this step.
    """
    client = _get_openai_client()
    response = client.chat.completions.create(
        model=settings.TRITONAI_TEXT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    "Here is the text extracted from the image:\n\n"
                    f"{raw_text}\n\n"
                    "Please structure this content according to the instructions above."
                ),
            },
        ],
        max_tokens=4096,
        temperature=0.1,
    )
    return response.choices[0].message.content or ""


def _call_vision_text_model(b64_image: str, mime_type: str, system_prompt: str) -> str:
    """
    Single-step fallback for the TritonAI path.

    Used when api-lightonocr-1b is unavailable. Sends the image directly to
    TRITONAI_VISION_MODEL (api-mistral-small-3.2-2506) which has Vision capability,
    unlike TRITONAI_TEXT_MODEL (api-gpt-oss-120b) which only supports text input.
    """
    client = _get_openai_client()
    response = client.chat.completions.create(
        model=settings.TRITONAI_VISION_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{b64_image}"},
                    },
                    {
                        "type": "text",
                        "text": "Please extract and structure the content from this image according to the instructions above.",
                    },
                ],
            },
        ],
        max_tokens=4096,
        temperature=0.1,
    )
    return response.choices[0].message.content or ""


def _call_anthropic(b64_image: str, mime_type: str, system_prompt: str) -> str:
    """Call Anthropic Claude directly with a vision request."""
    client = _get_anthropic_client()

    # Anthropic requires mime_type to be one of these specific values
    anthropic_media_types = {
        "image/jpeg": "image/jpeg",
        "image/png":  "image/png",
        "image/gif":  "image/gif",
        "image/webp": "image/webp",
    }
    media_type = anthropic_media_types.get(mime_type, "image/jpeg")

    response = client.messages.create(
        model=settings.ANTHROPIC_MODEL,
        max_tokens=4096,
        system=system_prompt,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64_image,
                        },
                    },
                    {
                        "type": "text",
                        "text": "Please extract the content from this image according to the instructions.",
                    },
                ],
            }
        ],
        temperature=0.1,
    )
    return response.content[0].text


# ── Study tool generation ─────────────────────────────────────────────────────

def generate_flashcards_from_text(sections_text: str) -> list[dict]:
    """
    Generate flashcards from plain text (combined section content).
    Returns a list of {"front": ..., "back": ...} dicts.
    """
    from prompts import build_flashcard_prompt
    prompt = build_flashcard_prompt(sections_text)

    provider = settings.AI_PROVIDER.lower()
    if provider == "tritonai":
        client = _get_openai_client()
        response = client.chat.completions.create(
            model=settings.TRITONAI_TEXT_MODEL,   # text-only; no image tokens
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2048,
            temperature=0.3,
        )
        raw = response.choices[0].message.content or "[]"
    else:
        client = _get_anthropic_client()
        response = client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        raw = response.content[0].text

    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        cards = json.loads(raw)
        return [c for c in cards if c.get("front") and c.get("back")]
    except json.JSONDecodeError:
        logger.error("Failed to parse flashcard response: %s", raw[:300])
        return []


def generate_practice_questions_from_text(sections_text: str) -> list[dict]:
    """
    Generate practice questions from plain text.
    Returns a list of question dicts matching PracticeQuestion schema.
    """
    from prompts import build_practice_questions_prompt
    prompt = build_practice_questions_prompt(sections_text)

    provider = settings.AI_PROVIDER.lower()
    if provider == "tritonai":
        client = _get_openai_client()
        response = client.chat.completions.create(
            model=settings.TRITONAI_TEXT_MODEL,   # text-only; no image tokens
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2048,
            temperature=0.4,
        )
        raw = response.choices[0].message.content or "[]"
    else:
        client = _get_anthropic_client()
        response = client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
        )
        raw = response.content[0].text

    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        questions = json.loads(raw)
        return [q for q in questions if q.get("question_text") and q.get("answer_text")]
    except json.JSONDecodeError:
        logger.error("Failed to parse practice questions response: %s", raw[:300])
        return []


def generate_course_summary(all_notes_text: str, course_name: str) -> str:
    """
    Generate a plain-text summary sheet from all notes in a course.
    Returns a plain text string (not JSON).
    """
    from prompts import build_course_summary_prompt
    prompt = build_course_summary_prompt(all_notes_text, course_name)

    provider = settings.AI_PROVIDER.lower()
    if provider == "tritonai":
        client = _get_openai_client()
        response = client.chat.completions.create(
            model=settings.TRITONAI_TEXT_MODEL,   # text-only
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1024,
            temperature=0.4,
        )
        return response.choices[0].message.content or ""
    else:
        client = _get_anthropic_client()
        response = client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
        )
        return response.content[0].text
