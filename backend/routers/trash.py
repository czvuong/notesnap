"""
routers/trash.py — /api/trash

Lists soft-deleted items and allows them to be restored.
All queries are scoped to the current user — users cannot see or restore
each other's deleted items.
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user
from config import settings
from database import get_db
from models import Course, Note, NoteSection
from schemas import MessageOut, TrashItemOut

router = APIRouter(prefix="/api/trash", tags=["trash"])

TTL = lambda: timedelta(days=settings.SOFT_DELETE_TTL_DAYS)


@router.get("", response_model=list[TrashItemOut])
def list_trash(
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """Return all soft-deleted items for the current user still within the recovery window."""
    cutoff = datetime.now(timezone.utc) - TTL()
    items: list[TrashItemOut] = []

    for note in db.query(Note).filter(
        Note.deleted_at != None,
        Note.deleted_at > cutoff,
        Note.user_id == current_user,
    ).all():
        items.append(TrashItemOut(
            item_type="note",
            id=note.id,
            label=note.title,
            deleted_at=note.deleted_at,
            restores_until=note.deleted_at + TTL(),
        ))

    # Sections are scoped through their parent note's user_id
    for section in (
        db.query(NoteSection)
        .join(Note, Note.id == NoteSection.note_id)
        .filter(
            NoteSection.deleted_at != None,
            NoteSection.deleted_at > cutoff,
            Note.user_id == current_user,
        ).all()
    ):
        items.append(TrashItemOut(
            item_type="section",
            id=section.id,
            label=section.heading or f"Section in note {section.note_id[:8]}",
            deleted_at=section.deleted_at,
            restores_until=section.deleted_at + TTL(),
        ))

    for course in db.query(Course).filter(
        Course.deleted_at != None,
        Course.deleted_at > cutoff,
        Course.user_id == current_user,
    ).all():
        items.append(TrashItemOut(
            item_type="course",
            id=course.id,
            label=course.name,
            deleted_at=course.deleted_at,
            restores_until=course.deleted_at + TTL(),
        ))

    return sorted(items, key=lambda x: x.deleted_at, reverse=True)


@router.post("/notes/{note_id}/restore", response_model=MessageOut)
def restore_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    note = db.query(Note).filter(
        Note.id == note_id, Note.deleted_at != None, Note.user_id == current_user
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Deleted note not found.")
    _check_ttl(note.deleted_at)

    note_deleted_at = note.deleted_at
    note.deleted_at = None
    for section in note.sections:
        if section.deleted_at and abs((section.deleted_at - note_deleted_at).total_seconds()) < 5:
            section.deleted_at = None

    db.commit()
    return MessageOut(message="Note restored.")


@router.post("/sections/{section_id}/restore", response_model=MessageOut)
def restore_section(
    section_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    # Join through Note to verify ownership
    section = (
        db.query(NoteSection)
        .join(Note, Note.id == NoteSection.note_id)
        .filter(
            NoteSection.id == section_id,
            NoteSection.deleted_at != None,
            Note.user_id == current_user,
        ).first()
    )
    if not section:
        raise HTTPException(status_code=404, detail="Deleted section not found.")
    _check_ttl(section.deleted_at)
    section.deleted_at = None
    db.commit()
    return MessageOut(message="Section restored.")


@router.post("/courses/{course_id}/restore", response_model=MessageOut)
def restore_course(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    course = db.query(Course).filter(
        Course.id == course_id, Course.deleted_at != None, Course.user_id == current_user
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Deleted course not found.")
    _check_ttl(course.deleted_at)
    course.deleted_at = None
    db.commit()
    return MessageOut(message="Course restored.")


def _check_ttl(deleted_at: datetime):
    now = datetime.now(timezone.utc) if deleted_at.tzinfo else datetime.utcnow()
    if now - deleted_at > TTL():
        raise HTTPException(
            status_code=410,
            detail="This item has passed the recovery window and cannot be restored.",
        )
