"""
routers/sections.py — /api/notes/{note_id}/sections

Granular section management. Every edit logs a SectionRevision before
writing, so no content is ever silently overwritten.

Access control:
  - Owner: full access to all operations.
  - Collaborator with 'edit' permission: can read and write sections.
  - Collaborator with 'view' or 'comment' permission: read-only (GET endpoints).
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import get_current_user_info
from config import settings
from database import get_db
from models import Note, NoteCollaborator, NoteSection, SectionRevision
from schemas import (
    MessageOut,
    RevisionOut,
    SectionCreate,
    SectionOut,
    SectionReorderRequest,
    SectionUpdate,
    SoftDeleteOut,
)

router = APIRouter(prefix="/api/notes/{note_id}/sections", tags=["sections"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_collab(db: Session, note_id: str, user_id: str, email: Optional[str]) -> Optional[NoteCollaborator]:
    filters = [NoteCollaborator.invitee_user_id == user_id]
    if email:
        filters.append(NoteCollaborator.invitee_email == email.lower())
    return db.query(NoteCollaborator).filter(
        NoteCollaborator.note_id == note_id,
        or_(*filters),
    ).first()


def _get_note_read(db: Session, note_id: str, user_id: str, email: Optional[str]) -> Note:
    """Allow owner OR any collaborator (view/edit/comment)."""
    note = db.query(Note).filter(
        Note.id == note_id, Note.deleted_at == None, Note.user_id == user_id
    ).first()
    if note:
        return note
    # Try collaborator path
    note = db.query(Note).filter(Note.id == note_id, Note.deleted_at == None).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    if not _get_collab(db, note_id, user_id, email):
        raise HTTPException(status_code=404, detail="Note not found.")
    return note


def _get_note_edit(db: Session, note_id: str, user_id: str, email: Optional[str]) -> Note:
    """Allow owner OR collaborator with 'edit' permission."""
    note = db.query(Note).filter(
        Note.id == note_id, Note.deleted_at == None, Note.user_id == user_id
    ).first()
    if note:
        return note
    # Try collaborator path
    note = db.query(Note).filter(Note.id == note_id, Note.deleted_at == None).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    collab = _get_collab(db, note_id, user_id, email)
    if not collab:
        raise HTTPException(status_code=404, detail="Note not found.")
    if collab.permission != "edit":
        raise HTTPException(status_code=403, detail="Edit permission required.")
    return note


def _get_active_section(db: Session, note_id: str, section_id: str) -> NoteSection:
    section = db.query(NoteSection).filter(
        NoteSection.id == section_id,
        NoteSection.note_id == note_id,
        NoteSection.deleted_at == None,
    ).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found.")
    return section

def _to_out(s: NoteSection) -> SectionOut:
    return SectionOut(
        id=s.id,
        note_id=s.note_id,
        section_order=s.section_order,
        heading=s.heading,
        content_type=s.content_type,
        content=s.content,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[SectionOut])
def list_sections(
    note_id: str,
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    user_id, email = current_user_info
    _get_note_read(db, note_id, user_id, email)
    sections = (
        db.query(NoteSection)
        .filter(NoteSection.note_id == note_id, NoteSection.deleted_at == None)
        .order_by(NoteSection.section_order)
        .all()
    )
    return [_to_out(s) for s in sections]


@router.post("", response_model=SectionOut, status_code=status.HTTP_201_CREATED)
def add_section(
    note_id: str,
    body: SectionCreate,
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    user_id, email = current_user_info
    note = _get_note_edit(db, note_id, user_id, email)
    section = NoteSection(
        note_id=note.id,
        section_order=body.section_order,
        heading=body.heading,
        content_type=body.content_type,
        content=body.content,
    )
    db.add(section)
    note.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(section)
    return _to_out(section)


@router.patch("/{section_id}", response_model=SectionOut)
def update_section(
    note_id: str,
    section_id: str,
    body: SectionUpdate,
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    user_id, email = current_user_info
    _get_note_edit(db, note_id, user_id, email)
    section = _get_active_section(db, note_id, section_id)

    any_content_changed = (
        (body.content is not None and body.content != section.content)
        or (body.heading is not None and body.heading != section.heading)
    )
    if any_content_changed:
        revision = SectionRevision(
            section_id=section.id,
            previous_content=section.content,
            new_content=body.content if body.content is not None else section.content,
            previous_heading=section.heading,
            new_heading=body.heading if body.heading is not None else section.heading,
            changed_by="user",
        )
        db.add(revision)

    if body.content is not None:
        section.content = body.content
    if body.heading is not None:
        section.heading = body.heading
    if body.content_type is not None:
        section.content_type = body.content_type
    if body.section_order is not None:
        section.section_order = body.section_order

    section.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(section)
    return _to_out(section)


@router.patch("", response_model=list[SectionOut])
def reorder_sections(
    note_id: str,
    body: SectionReorderRequest,
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    user_id, email = current_user_info
    _get_note_edit(db, note_id, user_id, email)
    for new_order, section_id in enumerate(body.order):
        section = _get_active_section(db, note_id, section_id)
        section.section_order = new_order
    db.commit()
    sections = (
        db.query(NoteSection)
        .filter(NoteSection.note_id == note_id, NoteSection.deleted_at == None)
        .order_by(NoteSection.section_order)
        .all()
    )
    return [_to_out(s) for s in sections]


@router.delete("/{section_id}", response_model=SoftDeleteOut)
def delete_section(
    note_id: str,
    section_id: str,
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    user_id, email = current_user_info
    _get_note_edit(db, note_id, user_id, email)
    section = _get_active_section(db, note_id, section_id)
    now = datetime.now(timezone.utc)
    section.deleted_at = now
    db.commit()
    return SoftDeleteOut(
        id=section.id,
        deleted_at=now,
        restores_until=now + timedelta(days=settings.SOFT_DELETE_TTL_DAYS),
    )


# ── Revision history ──────────────────────────────────────────────────────────

@router.get("/{section_id}/revisions", response_model=list[RevisionOut])
def get_revisions(
    note_id: str,
    section_id: str,
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    user_id, email = current_user_info
    _get_note_read(db, note_id, user_id, email)
    revisions = (
        db.query(SectionRevision)
        .filter(SectionRevision.section_id == section_id)
        .order_by(SectionRevision.changed_at.desc())
        .all()
    )
    return [
        RevisionOut(
            id=r.id,
            section_id=r.section_id,
            previous_content=r.previous_content,
            new_content=r.new_content,
            previous_heading=r.previous_heading,
            new_heading=r.new_heading,
            changed_by=r.changed_by,
            changed_at=r.changed_at,
        )
        for r in revisions
    ]


@router.post("/{section_id}/revisions/{revision_id}/restore", response_model=SectionOut)
def restore_revision(
    note_id: str,
    section_id: str,
    revision_id: str,
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    user_id, email = current_user_info
    _get_note_edit(db, note_id, user_id, email)
    section = _get_active_section(db, note_id, section_id)

    revision = db.query(SectionRevision).filter(
        SectionRevision.id == revision_id,
        SectionRevision.section_id == section_id,
    ).first()
    if not revision:
        raise HTTPException(status_code=404, detail="Revision not found.")

    restore_revision_log = SectionRevision(
        section_id=section.id,
        previous_content=section.content,
        new_content=revision.previous_content,
        previous_heading=section.heading,
        new_heading=revision.previous_heading,
        changed_by="user",
    )
    db.add(restore_revision_log)

    section.content = revision.previous_content
    section.heading = revision.previous_heading
    section.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(section)
    return _to_out(section)
