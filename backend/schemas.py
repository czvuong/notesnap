"""
schemas.py — Pydantic models for API request validation and response shaping.

Naming convention:
  - <Model>Create   → body of a POST request (fields required to create)
  - <Model>Update   → body of a PATCH request (all fields optional)
  - <Model>Out      → what the API returns (safe, serializable subset)

Why separate from ORM models?
  ORM models know about database internals (foreign keys, lazy-loading, etc.).
  Pydantic schemas know about the API surface. Keeping them separate means
  we never accidentally leak internal fields to the client.
"""

from __future__ import annotations
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


# ── Shared config ─────────────────────────────────────────────────────────────

class _Base(BaseModel):
    model_config = {"from_attributes": True}   # allows .model_validate(orm_obj)


# ── Courses ───────────────────────────────────────────────────────────────────

class CourseCreate(_Base):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    color_hex: str = Field("#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")

class CourseUpdate(_Base):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    color_hex: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")

class CourseOut(_Base):
    id: str
    name: str
    description: Optional[str]
    color_hex: str
    created_at: datetime
    updated_at: datetime
    note_count: int = 0   # populated by the route, not stored in DB


# ── Tags ──────────────────────────────────────────────────────────────────────

class TagOut(_Base):
    id: str
    name: str

class AddTagRequest(_Base):
    name: str = Field(..., min_length=1, max_length=100)


# ── Note Sections ─────────────────────────────────────────────────────────────

CONTENT_TYPES = Literal["text", "bullet_list", "equation", "diagram_description", "image"]

class SectionCreate(_Base):
    heading: Optional[str] = Field(None, max_length=500)
    content_type: CONTENT_TYPES = "text"
    content: str = Field(..., min_length=1, max_length=50_000)
    section_order: int = Field(0, ge=0)

class SectionUpdate(_Base):
    heading: Optional[str] = Field(None, max_length=500)
    content_type: Optional[CONTENT_TYPES] = None
    content: Optional[str] = Field(None, min_length=1, max_length=50_000)
    section_order: Optional[int] = Field(None, ge=0)

class SectionOut(_Base):
    id: str
    note_id: str
    section_order: int
    heading: Optional[str]
    content_type: str
    content: str
    created_at: datetime
    updated_at: datetime

class SectionReorderRequest(_Base):
    order: list[str] = Field(..., min_length=1)   # list of section IDs in new order


# ── Section Revisions ─────────────────────────────────────────────────────────

class RevisionOut(_Base):
    id: str
    section_id: str
    previous_content: str
    new_content: str
    previous_heading: Optional[str]
    new_heading: Optional[str]
    changed_by: str
    changed_at: datetime


# ── Notes ─────────────────────────────────────────────────────────────────────

EXTRACTION_MODES = Literal["transcribe", "study_guide"]

class NoteCreate(_Base):
    title: str = Field(..., min_length=1, max_length=500)
    course_id: Optional[str] = None
    batch_id: Optional[str] = None    # set by batch upload endpoint
    image_hash: Optional[str] = None  # SHA-256 of source file; used for duplicate detection
    tags: list[str] = Field(default_factory=list)
    extraction_mode: EXTRACTION_MODES
    ai_model_used: str = Field(..., max_length=100)
    sections: list[SectionCreate] = Field(..., min_length=1)

class NoteUpdate(_Base):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    course_id: Optional[str] = None   # pass null to unassign from course
    batch_id: Optional[str] = None    # pass null to remove from batch (ungroup)

class NoteListOut(_Base):
    """Paginated wrapper returned by GET /api/notes."""
    items: list["NoteSummaryOut"]
    total: int

class NoteSummaryOut(_Base):
    """Lightweight note representation for list views (no section content)."""
    id: str
    title: str
    course_id: Optional[str]
    batch_id: Optional[str] = None
    course: Optional[CourseOut] = None   # included so list views can group by course name
    extraction_mode: str
    ai_model_used: str
    tags: list[TagOut] = []
    section_count: int = 0
    flashcard_count: int = 0
    question_count: int = 0
    created_at: datetime
    updated_at: datetime

class NoteDetailOut(_Base):
    """Full note with all active sections."""
    id: str
    title: str
    course_id: Optional[str]
    batch_id: Optional[str] = None
    course: Optional[CourseOut] = None
    extraction_mode: str
    ai_model_used: str
    tags: list[TagOut] = []
    sections: list[SectionOut] = []
    is_public: bool = False
    public_slug: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ── Public sharing ────────────────────────────────────────────────────────────

class NoteShareRequest(_Base):
    is_public: bool

class PublicNoteOut(_Base):
    """Read-only note data returned for public/unauthenticated viewers."""
    id: str
    title: str
    extraction_mode: str
    sections: list[SectionOut] = []
    created_at: datetime


# ── Extraction ────────────────────────────────────────────────────────────────

class ExtractedSection(_Base):
    heading: Optional[str] = None
    content_type: CONTENT_TYPES = "text"
    content: str
    section_order: int = 0

class ExtractionResult(_Base):
    """
    What the /api/extract endpoint returns.
    The image is processed and dropped; only this structured data is sent
    back to the client. Nothing is persisted at this stage.
    """
    suggested_title: str
    extraction_mode: str
    ai_model_used: str
    sections: list[ExtractedSection]
    confidence: Literal["high", "medium", "low"] = "high"
    warnings: list[str] = []
    image_hash: Optional[str] = None   # SHA-256 of original file; stored in DB for duplicate detection


class OcrPreCheckResult(_Base):
    """
    What the /api/extract/pre-check endpoint returns.
    Runs only the cheap OCR step and heuristic quality assessment —
    the expensive structuring model is NOT called yet.
    The client shows a warning if confidence is 'low' and lets the user
    decide whether to proceed or cancel before spending the full extraction budget.
    """
    image_hash: str
    confidence: Literal["high", "medium", "low"]
    warnings: list[str] = []
    raw_text_preview: str = ""   # first ~500 chars of OCR output for the user to review


# ── Corrections ───────────────────────────────────────────────────────────────

CORRECTION_TYPES = Literal["spelling", "terminology", "formatting", "section_rename", "content"]

class CorrectionCreate(_Base):
    section_id: Optional[str] = None
    original_text: str = Field(..., min_length=1, max_length=10_000)
    corrected_text: str = Field(..., min_length=1, max_length=10_000)
    correction_type: CORRECTION_TYPES
    context_hint: Optional[str] = Field(None, max_length=500)

class CorrectionUpdate(_Base):
    active: Optional[bool] = None
    context_hint: Optional[str] = Field(None, max_length=500)

class CorrectionOut(_Base):
    id: str
    section_id: Optional[str]
    original_text: str
    corrected_text: str
    correction_type: str
    context_hint: Optional[str]
    active: bool
    created_at: datetime


# ── Flashcards ────────────────────────────────────────────────────────────────

class FlashcardOut(_Base):
    id: str
    note_id: str
    source_section_id: Optional[str]
    front: str
    back: str
    created_at: datetime

class FlashcardReviewCreate(_Base):
    result: Literal["known", "partial", "missed"]

class FlashcardReviewOut(_Base):
    id: str
    flashcard_id: str
    result: str
    reviewed_at: datetime


# ── Practice Questions ────────────────────────────────────────────────────────

class PracticeQuestionOut(_Base):
    id: str
    note_id: str
    question_text: str
    answer_text: str
    question_type: str
    options: Optional[str]   # JSON string, parsed by client
    created_at: datetime


# ── Study Sessions ────────────────────────────────────────────────────────────

class StudySessionOut(_Base):
    id: str
    note_ids: list[str]       # parsed from JSON
    note_titles: list[str]    # parsed from JSON
    tool: str
    items: list[dict]         # parsed from JSON
    created_at: datetime


# ── Preferences ───────────────────────────────────────────────────────────────

class PreferencesUpdate(_Base):
    default_mode: Optional[EXTRACTION_MODES] = None
    preferred_heading_style: Optional[Literal["bold", "numbered", "plain"]] = None
    preferred_bullet_style: Optional[Literal["dash", "dot", "arrow"]] = None
    extra_instructions: Optional[str] = Field(None, max_length=2000)
    theme: Optional[Literal["violet", "blue", "sage", "dark"]] = None

class PreferencesOut(_Base):
    id: str
    default_mode: str
    preferred_heading_style: str
    preferred_bullet_style: str
    extra_instructions: Optional[str]
    theme: str = "violet"   # default so responses never fail if theme missing
    updated_at: datetime


# ── Trash ─────────────────────────────────────────────────────────────────────

class TrashItemOut(_Base):
    """Unified representation of any soft-deleted item."""
    item_type: Literal["note", "section", "course", "flashcard"]
    id: str
    label: str        # human-readable name / title
    deleted_at: datetime
    restores_until: datetime   # deleted_at + TTL


# ── Soft-delete response ──────────────────────────────────────────────────────

class SoftDeleteOut(_Base):
    id: str
    deleted_at: datetime
    restores_until: datetime


# ── Cost tracking ─────────────────────────────────────────────────────────────

class CostLogOut(_Base):
    id: str
    model: str
    operation: str
    prompt_tokens: int
    completion_tokens: int
    estimated_cost_usd: Optional[float]
    created_at: datetime

class CostModelBreakdown(_Base):
    model: str
    operation: str
    calls: int
    prompt_tokens: int
    completion_tokens: int
    estimated_cost_usd: Optional[float]   # None if any call had unknown rate

class CostSummaryOut(_Base):
    total_calls: int
    total_prompt_tokens: int
    total_completion_tokens: int
    total_estimated_cost_usd: Optional[float]   # None if any model has unknown rate
    by_model_operation: list[CostModelBreakdown]


# ── Generic responses ─────────────────────────────────────────────────────────

class MessageOut(_Base):
    message: str
