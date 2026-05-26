"""
routers/notes.py — /api/notes

Handles saving, listing, fetching, updating, and soft-deleting notes.
Section content is managed separately in routers/sections.py so that
edits are always granular.
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import Course, Note, NoteSection, NoteTag, Tag
from schemas import (
    MessageOut,
    NoteCreate,
    NoteDetailOut,
    NoteListOut,
    NoteSummaryOut,
    NoteUpdate,
    SoftDeleteOut,
    TagOut,
    CourseOut,
    SectionOut,
)

router = APIRouter(prefix="/api/notes", tags=["notes"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_create_tag(db: Session, name: str) -> Tag:
    name = name.strip().lower()
    tag = db.query(Tag).filter(Tag.name == name).first()
    if not tag:
        tag = Tag(name=name)
        db.add(tag)
        db.flush()  # get the id without committing
    return tag

def _note_or_404(db: Session, note_id: str) -> Note:
    note = (
        db.query(Note)
        .filter(Note.id == note_id, Note.deleted_at == None)
        .first()
    )
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    return note

def _build_summary(note: Note) -> NoteSummaryOut:
    active_sections = [s for s in note.sections if s.deleted_at is None]
    tags = [TagOut(id=nt.tag.id, name=nt.tag.name) for nt in note.note_tags]
    course_out = None
    if note.course and note.course.deleted_at is None:
        course_out = CourseOut(
            id=note.course.id,
            name=note.course.name,
            description=note.course.description,
            color_hex=note.course.color_hex,
            created_at=note.course.created_at,
            updated_at=note.course.updated_at,
        )
    return NoteSummaryOut(
        id=note.id,
        title=note.title,
        course_id=note.course_id,
        course=course_out,
        extraction_mode=note.extraction_mode,
        ai_model_used=note.ai_model_used,
        tags=tags,
        section_count=len(active_sections),
        flashcard_count=len(note.flashcards),
        question_count=len(note.practice_qs),
        created_at=note.created_at,
        updated_at=note.updated_at,
    )

def _build_detail(note: Note) -> NoteDetailOut:
    active_sections = sorted(
        [s for s in note.sections if s.deleted_at is None],
        key=lambda s: s.section_order,
    )
    tags = [TagOut(id=nt.tag.id, name=nt.tag.name) for nt in note.note_tags]
    course_out = None
    if note.course and note.course.deleted_at is None:
        course_out = CourseOut(
            id=note.course.id,
            name=note.course.name,
            description=note.course.description,
            color_hex=note.course.color_hex,
            created_at=note.course.created_at,
            updated_at=note.course.updated_at,
        )
    sections_out = [
        SectionOut(
            id=s.id,
            note_id=s.note_id,
            section_order=s.section_order,
            heading=s.heading,
            content_type=s.content_type,
            content=s.content,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s in active_sections
    ]
    return NoteDetailOut(
        id=note.id,
        title=note.title,
        course_id=note.course_id,
        course=course_out,
        extraction_mode=note.extraction_mode,
        ai_model_used=note.ai_model_used,
        tags=tags,
        sections=sections_out,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=NoteListOut)
def list_notes(
    course_id: str | None = Query(None),
    tag: str | None = Query(None),
    mode: str | None = Query(None),
    q: str | None = Query(None, description="Search in title and section content"),
    sort: str = Query("newest", pattern="^(newest|oldest|alpha)$"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List all active notes, with optional filtering and pagination."""
    query = db.query(Note).filter(Note.deleted_at == None)

    if course_id:
        query = query.filter(Note.course_id == course_id)
    if mode:
        query = query.filter(Note.extraction_mode == mode)
    if tag:
        query = (
            query
            .join(NoteTag, NoteTag.note_id == Note.id)
            .join(Tag, Tag.id == NoteTag.tag_id)
            .filter(Tag.name == tag.strip().lower())
        )
    if q:
        search = f"%{q}%"
        # Search title OR any section content
        query = query.filter(
            or_(
                Note.title.ilike(search),
                Note.sections.any(
                    NoteSection.content.ilike(search) & (NoteSection.deleted_at == None)
                ),
            )
        )

    if sort == "newest":
        query = query.order_by(Note.created_at.desc())
    elif sort == "oldest":
        query = query.order_by(Note.created_at.asc())
    elif sort == "alpha":
        query = query.order_by(Note.title.asc())

    total  = query.count()
    offset = (page - 1) * limit
    notes  = query.offset(offset).limit(limit).all()
    return NoteListOut(items=[_build_summary(n) for n in notes], total=total)


@router.post("", response_model=NoteDetailOut, status_code=status.HTTP_201_CREATED)
def create_note(body: NoteCreate, db: Session = Depends(get_db)):
    """
    Save a new note with its sections.
    Called after the user reviews the extraction result and clicks Save.
    """
    # Validate course exists if provided
    if body.course_id:
        course = db.query(Course).filter(
            Course.id == body.course_id, Course.deleted_at == None
        ).first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found.")

    note = Note(
        title=body.title,
        course_id=body.course_id,
        extraction_mode=body.extraction_mode,
        ai_model_used=body.ai_model_used,
    )
    db.add(note)
    db.flush()  # get note.id before adding sections

    # Add sections
    for s in body.sections:
        section = NoteSection(
            note_id=note.id,
            section_order=s.section_order,
            heading=s.heading,
            content_type=s.content_type,
            content=s.content,
        )
        db.add(section)

    # Add tags
    for tag_name in body.tags:
        tag = _get_or_create_tag(db, tag_name)
        note_tag = NoteTag(note_id=note.id, tag_id=tag.id)
        db.add(note_tag)

    db.commit()
    db.refresh(note)
    return _build_detail(note)


@router.get("/{note_id}", response_model=NoteDetailOut)
def get_note(note_id: str, db: Session = Depends(get_db)):
    """Get a single note with all its active sections."""
    note = _note_or_404(db, note_id)
    return _build_detail(note)


@router.patch("/{note_id}", response_model=NoteDetailOut)
def update_note(note_id: str, body: NoteUpdate, db: Session = Depends(get_db)):
    """
    Update note-level metadata (title, course assignment).
    Does NOT touch sections — use /api/notes/{id}/sections for that.
    """
    note = _note_or_404(db, note_id)

    if body.title is not None:
        note.title = body.title
    if "course_id" in body.model_fields_set:
        if body.course_id is not None:
            course = db.query(Course).filter(
                Course.id == body.course_id, Course.deleted_at == None
            ).first()
            if not course:
                raise HTTPException(status_code=404, detail="Course not found.")
        note.course_id = body.course_id

    note.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(note)
    return _build_detail(note)


@router.delete("/{note_id}", response_model=SoftDeleteOut)
def delete_note(note_id: str, db: Session = Depends(get_db)):
    """
    Soft-delete a note and all its sections.
    The note remains in the database for SOFT_DELETE_TTL_DAYS days
    and can be restored from the Trash view.
    """
    note = _note_or_404(db, note_id)
    now = datetime.now(timezone.utc)
    restores_until = now + timedelta(days=settings.SOFT_DELETE_TTL_DAYS)

    note.deleted_at = now
    # Soft-delete all sections too
    for section in note.sections:
        if section.deleted_at is None:
            section.deleted_at = now

    db.commit()
    return SoftDeleteOut(id=note.id, deleted_at=now, restores_until=restores_until)


# ── Tag management on a note ──────────────────────────────────────────────────

@router.post("/{note_id}/tags", response_model=NoteDetailOut, status_code=status.HTTP_201_CREATED)
def add_tag(note_id: str, body: dict, db: Session = Depends(get_db)):
    """Add a tag to a note. Creates the tag if it doesn't exist yet."""
    note = _note_or_404(db, note_id)
    tag_name = (body.get("name") or "").strip()
    if not tag_name:
        raise HTTPException(status_code=422, detail="Tag name cannot be empty.")

    tag = _get_or_create_tag(db, tag_name)

    # Check not already applied
    existing = db.query(NoteTag).filter(
        NoteTag.note_id == note.id, NoteTag.tag_id == tag.id
    ).first()
    if not existing:
        db.add(NoteTag(note_id=note.id, tag_id=tag.id))
        db.commit()
        db.refresh(note)

    return _build_detail(note)


@router.delete("/{note_id}/tags/{tag_id}", response_model=MessageOut)
def remove_tag(note_id: str, tag_id: str, db: Session = Depends(get_db)):
    """Remove a tag from a note."""
    _note_or_404(db, note_id)
    note_tag = db.query(NoteTag).filter(
        NoteTag.note_id == note_id, NoteTag.tag_id == tag_id
    ).first()
    if not note_tag:
        raise HTTPException(status_code=404, detail="Tag not found on this note.")
    db.delete(note_tag)
    db.commit()
    return MessageOut(message="Tag removed.")
