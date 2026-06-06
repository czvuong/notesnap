"""
models.py — SQLAlchemy ORM models (one class = one database table).

Design rules enforced here:
  - Every table has a UUID primary key (not an integer — harder to enumerate).
  - Every content table has created_at, updated_at, and deleted_at.
  - deleted_at = NULL means the row is active.
  - deleted_at = <timestamp> means soft-deleted; the background job will
    permanently remove it after SOFT_DELETE_TTL_DAYS.
  - The section_revisions table is the ONLY table without deleted_at —
    revision history is a permanent audit log and is never removed.
  - We intentionally have NO column for storing uploaded images.
  - user_id is nullable for now (local dev without Clerk). The auth
    middleware in auth.py enforces it on all protected routes.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


# ── Helpers ───────────────────────────────────────────────────────────────────

def _uuid() -> str:
    """Generate a new UUID4 string. Used as the default for primary keys."""
    return str(uuid.uuid4())

def _now() -> datetime:
    """UTC-aware current timestamp."""
    return datetime.now(timezone.utc)


# ── Models ────────────────────────────────────────────────────────────────────

class Course(Base):
    __tablename__ = "courses"

    id          = Column(String, primary_key=True, default=_uuid)
    user_id     = Column(String, nullable=True, index=True)
    name        = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    color_hex   = Column(String(7), nullable=False, default="#6366f1")
    created_at  = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at  = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)
    deleted_at  = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    notes = relationship("Note", back_populates="course")


class Note(Base):
    __tablename__ = "notes"

    id              = Column(String, primary_key=True, default=_uuid)
    user_id         = Column(String, nullable=True, index=True)
    title           = Column(String(500), nullable=False)
    course_id       = Column(String, ForeignKey("courses.id"), nullable=True)
    batch_id        = Column(String, nullable=True, index=True)  # groups notes from one batch upload
    image_hash      = Column(String(64), nullable=True, index=True)  # SHA-256 of original file bytes
    extraction_mode = Column(String(20), nullable=False)   # "transcribe" | "study_guide"
    ai_model_used   = Column(String(100), nullable=False)
    created_at      = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at      = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)
    deleted_at      = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    course      = relationship("Course", back_populates="notes")
    sections    = relationship(
        "NoteSection",
        back_populates="note",
        order_by="NoteSection.section_order",
        cascade="all, delete-orphan",
    )
    note_tags       = relationship("NoteTag", back_populates="note", cascade="all, delete-orphan")
    flashcards      = relationship("Flashcard", back_populates="note", cascade="all, delete-orphan")
    practice_qs     = relationship("PracticeQuestion", back_populates="note", cascade="all, delete-orphan")


class NoteSection(Base):
    __tablename__ = "note_sections"

    id            = Column(String, primary_key=True, default=_uuid)
    note_id       = Column(String, ForeignKey("notes.id"), nullable=False)
    section_order = Column(Integer, nullable=False, default=0)
    heading       = Column(String(500), nullable=True)
    # content_type: "text" | "bullet_list" | "equation" | "diagram_description"
    content_type  = Column(String(30), nullable=False, default="text")
    content       = Column(Text, nullable=False)
    created_at    = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at    = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)
    deleted_at    = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    note      = relationship("Note", back_populates="sections")
    revisions = relationship(
        "SectionRevision",
        back_populates="section",
        order_by="SectionRevision.changed_at.desc()",
        cascade="all, delete-orphan",
    )
    corrections = relationship("Correction", back_populates="section")


class SectionRevision(Base):
    """
    Immutable audit log of every edit made to a section.
    Never soft-deleted — this is the user's version history.
    """
    __tablename__ = "section_revisions"

    id               = Column(String, primary_key=True, default=_uuid)
    section_id       = Column(String, ForeignKey("note_sections.id"), nullable=False)
    previous_content = Column(Text, nullable=False)
    new_content      = Column(Text, nullable=False)
    previous_heading = Column(String(500), nullable=True)
    new_heading      = Column(String(500), nullable=True)
    # "user" = human made this edit; "system" = AI extraction or restore
    changed_by       = Column(String(10), nullable=False, default="user")
    changed_at       = Column(DateTime(timezone=True), nullable=False, default=_now)

    # Relationships
    section = relationship("NoteSection", back_populates="revisions")


class Tag(Base):
    __tablename__ = "tags"
    # Tags are per-user: unique constraint is (user_id, name) not just name
    __table_args__ = (UniqueConstraint("user_id", "name"),)

    id         = Column(String, primary_key=True, default=_uuid)
    user_id    = Column(String, nullable=True, index=True)
    name       = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    # Relationships
    note_tags = relationship("NoteTag", back_populates="tag", cascade="all, delete-orphan")


class NoteTag(Base):
    """Junction table between Note and Tag (many-to-many)."""
    __tablename__ = "note_tags"
    __table_args__ = (UniqueConstraint("note_id", "tag_id"),)

    note_id    = Column(String, ForeignKey("notes.id"), primary_key=True)
    tag_id     = Column(String, ForeignKey("tags.id"), primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    # Relationships
    note = relationship("Note", back_populates="note_tags")
    tag  = relationship("Tag", back_populates="note_tags")


class Correction(Base):
    """
    Stores user-approved corrections that get injected into future AI prompts.
    The user explicitly opts in to saving a correction — we don't silently
    learn from every keystroke.
    """
    __tablename__ = "corrections"

    id               = Column(String, primary_key=True, default=_uuid)
    user_id          = Column(String, nullable=True, index=True)
    section_id       = Column(String, ForeignKey("note_sections.id"), nullable=True)
    original_text    = Column(Text, nullable=False)
    corrected_text   = Column(Text, nullable=False)
    # "spelling" | "terminology" | "formatting" | "section_rename" | "content"
    correction_type  = Column(String(30), nullable=False)
    context_hint     = Column(Text, nullable=True)
    active           = Column(Boolean, nullable=False, default=True)
    created_at       = Column(DateTime(timezone=True), nullable=False, default=_now)

    # Corrections use hard delete (they're user preferences, not content)
    # No deleted_at column intentionally.

    # Relationships
    section = relationship("NoteSection", back_populates="corrections")


class Flashcard(Base):
    __tablename__ = "flashcards"

    id                = Column(String, primary_key=True, default=_uuid)
    note_id           = Column(String, ForeignKey("notes.id"), nullable=False)
    source_section_id = Column(String, ForeignKey("note_sections.id"), nullable=True)
    front             = Column(Text, nullable=False)
    back              = Column(Text, nullable=False)
    # SHA-256 of the note's section text at generation time.
    # Used to skip LLM calls when content hasn't changed (cache key).
    # NULL on rows created before this column was added — treated as stale.
    content_hash      = Column(String(64), nullable=True, index=True)
    created_at        = Column(DateTime(timezone=True), nullable=False, default=_now)
    deleted_at        = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    note    = relationship("Note", back_populates="flashcards")
    reviews = relationship("FlashcardReview", back_populates="flashcard", cascade="all, delete-orphan")


class FlashcardReview(Base):
    """Lightweight spaced-repetition tracking."""
    __tablename__ = "flashcard_reviews"

    id           = Column(String, primary_key=True, default=_uuid)
    flashcard_id = Column(String, ForeignKey("flashcards.id"), nullable=False)
    # "known" | "partial" | "missed"
    result       = Column(String(10), nullable=False)
    reviewed_at  = Column(DateTime(timezone=True), nullable=False, default=_now)

    # Relationships
    flashcard = relationship("Flashcard", back_populates="reviews")


class PracticeQuestion(Base):
    __tablename__ = "practice_questions"

    id            = Column(String, primary_key=True, default=_uuid)
    note_id       = Column(String, ForeignKey("notes.id"), nullable=False)
    question_text = Column(Text, nullable=False)
    answer_text   = Column(Text, nullable=False)
    # "short_answer" | "multiple_choice"
    question_type = Column(String(20), nullable=False, default="short_answer")
    # JSON array string for MCQ options — null for short_answer
    options       = Column(Text, nullable=True)
    # SHA-256 of the note's section text at generation time (cache key).
    # NULL on rows created before this column was added — treated as stale.
    content_hash  = Column(String(64), nullable=True, index=True)
    created_at    = Column(DateTime(timezone=True), nullable=False, default=_now)
    deleted_at    = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    note = relationship("Note", back_populates="practice_qs")


class StudySession(Base):
    """
    A saved multi-note study session.
    Stores the set of note IDs and the generated flashcards / practice questions
    as a JSON blob so no changes are needed to the Flashcard or PracticeQuestion
    tables (multi-note items cannot be attributed to a single note).
    """
    __tablename__ = "study_sessions"

    id          = Column(String, primary_key=True, default=_uuid)
    user_id     = Column(String, nullable=True, index=True)
    note_ids    = Column(Text, nullable=False)           # JSON list of note UUIDs
    note_titles = Column(Text, nullable=False)           # JSON list of note titles (for display without extra JOIN)
    tool        = Column(String(30), nullable=False)     # "flashcards" | "practice_questions"
    items       = Column(Text, nullable=False)           # JSON list of generated cards/questions
    # SHA-256 of (sorted combined note content + tool). Cache key: if same notes,
    # same tool, and no sections edited, return this session instead of calling LLM.
    # NULL on rows created before this column was added.
    content_hash = Column(String(64), nullable=True, index=True)
    created_at  = Column(DateTime(timezone=True), nullable=False, default=_now)
    deleted_at  = Column(DateTime(timezone=True), nullable=True)


class CostLog(Base):
    """
    One row per LLM API call. Tracks token usage and estimated cost.
    Also used to enforce per-user daily extraction limits.

    estimated_cost_usd is NULL when the model's published rate is unknown
    (e.g. TritonAI internal models). Token counts are always recorded.
    """
    __tablename__ = "cost_logs"

    id                 = Column(String, primary_key=True, default=_uuid)
    user_id            = Column(String, nullable=True, index=True)
    model              = Column(String(100), nullable=False)
    # "ocr" | "structure" | "vision_structure" | "flashcards" |
    # "practice_questions" | "course_summary" | "pdf_structure"
    operation          = Column(String(50), nullable=False)
    prompt_tokens      = Column(Integer, nullable=False, default=0)
    completion_tokens  = Column(Integer, nullable=False, default=0)
    estimated_cost_usd = Column(Float, nullable=True)   # NULL = rate unknown
    created_at         = Column(DateTime(timezone=True), nullable=False, default=_now)


class UserPreferences(Base):
    """
    Per-user preferences. One row per user (keyed by user_id).
    GET creates the row with defaults if it doesn't exist for that user yet.
    """
    __tablename__ = "user_preferences"

    id                      = Column(String, primary_key=True, default=_uuid)
    user_id                 = Column(String, nullable=True, index=True)
    default_mode            = Column(String(20), nullable=False, default="transcribe")
    preferred_heading_style = Column(String(20), nullable=False, default="bold")
    preferred_bullet_style  = Column(String(10), nullable=False, default="dash")
    extra_instructions      = Column(Text, nullable=True)
    # NOTE: `theme` is intentionally NOT listed here so SQLAlchemy never includes
    # it in generated SELECTs. It lives in the DB (added by _run_migrations) but
    # is read/written via raw SQL in the preferences router to avoid crashing on
    # deployments where the migration hasn't run yet.
    updated_at              = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)
