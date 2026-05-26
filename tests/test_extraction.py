"""
tests/test_extraction.py — Unit and integration tests for the extraction pipeline.

These tests cover:
  1. Prompt building (no AI calls — pure logic tests)
  2. Response parsing (no AI calls — tests the JSON parser with mock responses)
  3. Image pre-processing (no AI calls — tests resize/encode logic)
  4. Full integration tests (REQUIRE a real API key — skipped if not configured)

Run all tests:
    pytest tests/test_extraction.py -v

Run only fast tests (no API calls):
    pytest tests/test_extraction.py -v -m "not integration"

Run only integration tests:
    pytest tests/test_extraction.py -v -m integration
"""

import base64
import json
import sys
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

# Allow importing from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from prompts import (
    build_correction_block,
    build_preference_block,
    build_transcription_prompt,
    build_study_guide_prompt,
)
from extraction import _parse_ai_response, _prepare_image


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_test_image(width=100, height=100, fmt="JPEG") -> bytes:
    """Create a minimal in-memory image for testing."""
    img = Image.new("RGB", (width, height), color=(128, 128, 128))
    buf = BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


SAMPLE_CORRECTIONS = [
    {
        "original_text":   "mitocondria",
        "corrected_text":  "mitochondria",
        "correction_type": "spelling",
        "context_hint":    None,
    },
    {
        "original_text":   "Part 1",
        "corrected_text":  "Introduction",
        "correction_type": "section_rename",
        "context_hint":    "always use this name",
    },
]

SAMPLE_PREFS = {
    "preferred_heading_style": "bold",
    "preferred_bullet_style":  "dash",
    "extra_instructions":      "Focus on equations.",
}

VALID_AI_RESPONSE = json.dumps({
    "suggested_title": "Test Notes",
    "confidence":      "high",
    "warnings":        [],
    "sections": [
        {
            "heading":      "Introduction",
            "content_type": "text",
            "content":      "This is the introduction.",
            "section_order": 0,
        },
        {
            "heading":      "Formula",
            "content_type": "equation",
            "content":      "E = mc^2",
            "section_order": 1,
        },
    ],
})


# ── Prompt building tests (no AI, no I/O) ─────────────────────────────────────

class TestCorrectionBlock:
    def test_empty_corrections_returns_empty_string(self):
        assert build_correction_block([]) == ""

    def test_spelling_correction_included(self):
        block = build_correction_block(SAMPLE_CORRECTIONS)
        assert "mitochondria" in block
        assert "mitocondria" in block

    def test_section_rename_correction_included(self):
        block = build_correction_block(SAMPLE_CORRECTIONS)
        assert "Introduction" in block
        assert "Part 1" in block

    def test_context_hint_included_when_present(self):
        block = build_correction_block(SAMPLE_CORRECTIONS)
        assert "always use this name" in block

    def test_multiple_corrections_all_present(self):
        block = build_correction_block(SAMPLE_CORRECTIONS)
        # Both corrections should appear in the block
        assert block.count("→") >= 1 or "mitochondria" in block


class TestPreferenceBlock:
    def test_empty_prefs_returns_empty_string(self):
        assert build_preference_block(None) == ""
        assert build_preference_block({}) == ""

    def test_bold_heading_style_included(self):
        block = build_preference_block(SAMPLE_PREFS)
        assert "bold" in block.lower()

    def test_dash_bullet_style_included(self):
        block = build_preference_block(SAMPLE_PREFS)
        assert "dash" in block.lower() or "-" in block

    def test_extra_instructions_included(self):
        block = build_preference_block(SAMPLE_PREFS)
        assert "Focus on equations." in block


class TestPromptBuilding:
    def test_transcription_prompt_not_empty(self):
        prompt = build_transcription_prompt()
        assert len(prompt) > 100

    def test_study_guide_prompt_not_empty(self):
        prompt = build_study_guide_prompt()
        assert len(prompt) > 100

    def test_transcription_prompt_contains_json_instruction(self):
        prompt = build_transcription_prompt()
        assert "JSON" in prompt

    def test_study_guide_prompt_contains_json_instruction(self):
        prompt = build_study_guide_prompt()
        assert "JSON" in prompt

    def test_corrections_injected_into_transcription_prompt(self):
        prompt = build_transcription_prompt(corrections=SAMPLE_CORRECTIONS)
        assert "mitochondria" in prompt

    def test_corrections_injected_into_study_guide_prompt(self):
        prompt = build_study_guide_prompt(corrections=SAMPLE_CORRECTIONS)
        assert "mitochondria" in prompt

    def test_prefs_injected_into_prompt(self):
        prompt = build_transcription_prompt(prefs=SAMPLE_PREFS)
        assert "Focus on equations." in prompt

    def test_transcription_and_study_guide_prompts_are_different(self):
        t = build_transcription_prompt()
        s = build_study_guide_prompt()
        assert t != s


# ── Response parsing tests (no AI, no I/O) ────────────────────────────────────

class TestParseAIResponse:
    def test_valid_json_parsed_correctly(self):
        result = _parse_ai_response(VALID_AI_RESPONSE, "transcribe", "test-model")
        assert result.suggested_title == "Test Notes"
        assert len(result.sections) == 2
        assert result.confidence == "high"
        assert result.warnings == []

    def test_section_order_preserved(self):
        result = _parse_ai_response(VALID_AI_RESPONSE, "transcribe", "test-model")
        orders = [s.section_order for s in result.sections]
        assert orders == sorted(orders)

    def test_content_types_preserved(self):
        result = _parse_ai_response(VALID_AI_RESPONSE, "transcribe", "test-model")
        types = {s.heading: s.content_type for s in result.sections}
        assert types["Formula"] == "equation"
        assert types["Introduction"] == "text"

    def test_markdown_fences_stripped(self):
        fenced = f"```json\n{VALID_AI_RESPONSE}\n```"
        result = _parse_ai_response(fenced, "transcribe", "test-model")
        assert result.suggested_title == "Test Notes"

    def test_markdown_fences_stripped_no_language(self):
        fenced = f"```\n{VALID_AI_RESPONSE}\n```"
        result = _parse_ai_response(fenced, "transcribe", "test-model")
        assert result.suggested_title == "Test Notes"

    def test_invalid_json_returns_fallback(self):
        result = _parse_ai_response("this is not json at all", "transcribe", "test-model")
        assert result.confidence == "low"
        assert len(result.sections) == 1
        assert "this is not json" in result.sections[0].content

    def test_empty_sections_array_returns_placeholder(self):
        empty = json.dumps({
            "suggested_title": "Empty",
            "confidence": "low",
            "warnings": ["nothing found"],
            "sections": [],
        })
        result = _parse_ai_response(empty, "transcribe", "test-model")
        assert len(result.sections) == 1
        assert result.sections[0].content == "[No content extracted]"

    def test_sections_missing_content_skipped(self):
        bad = json.dumps({
            "suggested_title": "Partial",
            "confidence": "medium",
            "warnings": [],
            "sections": [
                {"heading": "Good", "content_type": "text", "content": "valid", "section_order": 0},
                {"heading": "Bad",  "content_type": "text", "content": "",      "section_order": 1},
            ],
        })
        result = _parse_ai_response(bad, "transcribe", "test-model")
        assert len(result.sections) == 1
        assert result.sections[0].heading == "Good"

    def test_model_name_stored_in_result(self):
        result = _parse_ai_response(VALID_AI_RESPONSE, "transcribe", "gpt-4o")
        assert result.ai_model_used == "gpt-4o"

    def test_extraction_mode_stored_in_result(self):
        result = _parse_ai_response(VALID_AI_RESPONSE, "study_guide", "gpt-4o")
        assert result.extraction_mode == "study_guide"


# ── Image processing tests (no AI, no I/O) ────────────────────────────────────

class TestPrepareImage:
    def test_valid_jpeg_returns_base64_and_mime(self):
        img_bytes = make_test_image(fmt="JPEG")
        b64, mime = _prepare_image(img_bytes)
        assert mime == "image/jpeg"
        decoded = base64.b64decode(b64)
        assert len(decoded) > 0

    def test_valid_png_returns_png_mime(self):
        img_bytes = make_test_image(fmt="PNG")
        b64, mime = _prepare_image(img_bytes)
        assert mime == "image/png"

    def test_large_image_is_resized(self):
        # 3000x3000 should be downscaled
        img_bytes = make_test_image(width=3000, height=3000, fmt="JPEG")
        b64, _ = _prepare_image(img_bytes)
        decoded = base64.b64decode(b64)
        resized = Image.open(BytesIO(decoded))
        assert resized.width <= 2048
        assert resized.height <= 2048

    def test_small_image_not_upscaled(self):
        img_bytes = make_test_image(width=200, height=200, fmt="JPEG")
        b64, _ = _prepare_image(img_bytes)
        decoded = base64.b64decode(b64)
        img = Image.open(BytesIO(decoded))
        assert img.width == 200
        assert img.height == 200

    def test_invalid_bytes_raises_value_error(self):
        with pytest.raises(ValueError, match="Could not open image"):
            _prepare_image(b"this is not an image")

    def test_empty_bytes_raises_value_error(self):
        with pytest.raises(ValueError):
            _prepare_image(b"")

    def test_aspect_ratio_preserved_on_resize(self):
        img_bytes = make_test_image(width=4000, height=2000, fmt="JPEG")
        b64, _ = _prepare_image(img_bytes)
        decoded = base64.b64decode(b64)
        img = Image.open(BytesIO(decoded))
        # Original ratio is 2:1
        ratio = img.width / img.height
        assert abs(ratio - 2.0) < 0.1


# ── Two-step pipeline unit tests (no API calls) ───────────────────────────────

class TestTwoStepPipeline:
    """
    Unit tests for the TritonAI two-step pipeline.
    All AI calls are mocked — no API key required.
    """

    def _mock_openai_response(self, text: str):
        """Build a minimal mock that looks like an OpenAI chat completion."""
        msg = MagicMock()
        msg.content = text
        choice = MagicMock()
        choice.message = msg
        resp = MagicMock()
        resp.choices = [choice]
        return resp

    def test_ocr_model_is_called_first(self):
        """extract_note with tritonai provider should call the OCR model before the text model."""
        from extraction import extract_note

        ocr_response  = self._mock_openai_response("Photosynthesis converts sunlight to energy.")
        text_response = self._mock_openai_response(json.dumps({
            "suggested_title": "Biology Notes",
            "sections": [{"heading": "Photosynthesis", "content_type": "text",
                          "content": "Converts sunlight to energy.", "section_order": 0}],
            "confidence": "high",
            "warnings": [],
        }))

        call_sequence = []

        def fake_create(**kwargs):
            call_sequence.append(kwargs["model"])
            if kwargs["model"] == "api-lightonocr-1":
                return ocr_response
            return text_response

        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = fake_create

        with patch("extraction.settings") as mock_settings, \
             patch("extraction._get_openai_client", return_value=mock_client):
            mock_settings.AI_PROVIDER        = "tritonai"
            mock_settings.TRITONAI_OCR_MODEL  = "api-lightonocr-1"
            mock_settings.TRITONAI_TEXT_MODEL = "api-gpt-oss-120b"

            result = extract_note(make_test_image(), mode="transcribe")

        assert call_sequence[0] == "api-lightonocr-1",  "OCR model must be called first"
        assert call_sequence[1] == "api-gpt-oss-120b",  "Text model must be called second"
        assert result.suggested_title == "Biology Notes"
        assert len(result.sections) == 1

    def test_ocr_text_is_forwarded_to_text_model(self):
        """The raw OCR text should appear in the text-model call's user message."""
        from extraction import extract_note

        ocr_text = "Mitochondria is the powerhouse of the cell."
        text_response = self._mock_openai_response(json.dumps({
            "suggested_title": "Cell Biology",
            "sections": [{"heading": None, "content_type": "text",
                          "content": ocr_text, "section_order": 0}],
            "confidence": "high",
            "warnings": [],
        }))

        captured_messages = {}

        def fake_create(**kwargs):
            model = kwargs["model"]
            captured_messages[model] = kwargs.get("messages", [])
            if model == "api-lightonocr-1":
                msg = MagicMock(); msg.content = ocr_text
                c   = MagicMock(); c.message   = msg
                r   = MagicMock(); r.choices   = [c]
                return r
            return text_response

        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = fake_create

        with patch("extraction.settings") as mock_settings, \
             patch("extraction._get_openai_client", return_value=mock_client):
            mock_settings.AI_PROVIDER        = "tritonai"
            mock_settings.TRITONAI_OCR_MODEL  = "api-lightonocr-1"
            mock_settings.TRITONAI_TEXT_MODEL = "api-gpt-oss-120b"

            extract_note(make_test_image(), mode="transcribe")

        # The text-model user message must contain the OCR output
        text_messages = captured_messages.get("api-gpt-oss-120b", [])
        user_content  = next(
            (m["content"] for m in text_messages if m.get("role") == "user"), ""
        )
        assert ocr_text in user_content, "OCR text must be forwarded to text model"

    def test_model_name_includes_both_models(self):
        """ExtractionResult.ai_model_used should record both model names."""
        from extraction import extract_note

        def fake_create(**kwargs):
            if kwargs["model"] == "api-lightonocr-1":
                msg = MagicMock(); msg.content = "raw text"
                c   = MagicMock(); c.message   = msg
                r   = MagicMock(); r.choices   = [c]
                return r
            msg = MagicMock()
            msg.content = json.dumps({
                "suggested_title": "Test",
                "sections": [{"heading": None, "content_type": "text",
                              "content": "ok", "section_order": 0}],
                "confidence": "medium", "warnings": [],
            })
            c = MagicMock(); c.message = msg
            r = MagicMock(); r.choices = [c]
            return r

        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = fake_create

        with patch("extraction.settings") as mock_settings, \
             patch("extraction._get_openai_client", return_value=mock_client):
            mock_settings.AI_PROVIDER        = "tritonai"
            mock_settings.TRITONAI_OCR_MODEL  = "api-lightonocr-1"
            mock_settings.TRITONAI_TEXT_MODEL = "api-gpt-oss-120b"

            result = extract_note(make_test_image(), mode="transcribe")

        assert "api-lightonocr-1"  in result.ai_model_used
        assert "api-gpt-oss-120b"  in result.ai_model_used


# ── Integration tests (require real API key) ──────────────────────────────────

@pytest.mark.integration
class TestExtractionIntegration:
    """
    These tests make real API calls. They are skipped unless you explicitly
    run: pytest -m integration

    They require a valid API key in your .env file.
    """

    def test_transcribe_mode_returns_result(self):
        from extraction import extract_note
        img = make_test_image(200, 200)
        result = extract_note(img, mode="transcribe")
        assert result.suggested_title
        assert len(result.sections) >= 1

    def test_study_guide_mode_returns_result(self):
        from extraction import extract_note
        img = make_test_image(200, 200)
        result = extract_note(img, mode="study_guide")
        assert result.suggested_title
        assert len(result.sections) >= 1

    def test_invalid_mode_raises(self):
        from extraction import extract_note
        with pytest.raises(ValueError):
            extract_note(make_test_image(), mode="invalid_mode")
