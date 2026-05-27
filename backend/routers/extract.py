"""
routers/extract.py — POST /api/extract

Receives an uploaded image, runs it through the AI extraction pipeline,
and returns structured content. Nothing is written to the database here.
The image bytes are used only within this request and then discarded.

All routes require authentication. Corrections and preferences are loaded
per-user. A daily extraction limit is enforced per user.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from auth import get_current_user
from config import settings
from database import get_db
from extraction import extract_note
from models import Correction, Note, NoteSection, UserPreferences
from schemas import ExtractionResult

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/extract", tags=["extraction"])

ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/jpg", "image/png",
    "image/gif", "image/webp", "image/heic",
    "application/pdf",
}

MAX_BATCH_FILES = 20


def _check_daily_limit(db: Session, user_id: str) -> None:
    """Raise 429 if the user has hit their daily extraction limit."""
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    count = db.query(Note).filter(
        Note.user_id == user_id,
        Note.created_at >= today_start,
    ).count()
    if count >= settings.DAILY_EXTRACTION_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Daily extraction limit of {settings.DAILY_EXTRACTION_LIMIT} reached. Try again tomorrow.",
        )


def _load_user_context(db: Session, user_id: str) -> tuple[list, dict | None]:
    """Load the user's active corrections and preferences for prompt injection."""
    corrections = db.query(Correction).filter(
        Correction.active == True, Correction.user_id == user_id
    ).all()
    corrections_dicts = [
        {
            "original_text":   c.original_text,
            "corrected_text":  c.corrected_text,
            "correction_type": c.correction_type,
            "context_hint":    c.context_hint,
        }
        for c in corrections
    ]

    prefs_row = db.query(UserPreferences).filter(
        UserPreferences.user_id == user_id
    ).first()
    prefs_dict = (
        {
            "default_mode":            prefs_row.default_mode,
            "preferred_heading_style": prefs_row.preferred_heading_style,
            "preferred_bullet_style":  prefs_row.preferred_bullet_style,
            "extra_instructions":      prefs_row.extra_instructions,
        }
        if prefs_row else None
    )
    return corrections_dicts, prefs_dict


@router.post("", response_model=ExtractionResult)
async def extract(
    file: UploadFile = File(...),
    mode: str = Form("transcribe"),
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    if mode not in ("transcribe", "study_guide"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid mode '{mode}'. Must be 'transcribe' or 'study_guide'.",
        )

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{content_type}'. Upload a JPEG, PNG, WebP, or PDF.",
        )

    image_bytes = await file.read()
    if len(image_bytes) > settings.MAX_UPLOAD_BYTES:
        mb = settings.MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {mb} MB limit.",
        )
    if len(image_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty.",
        )

    _check_daily_limit(db, current_user)
    corrections_dicts, prefs_dict = _load_user_context(db, current_user)

    try:
        result = extract_note(
            image_bytes=image_bytes,
            mode=mode,
            corrections=corrections_dicts,
            prefs=prefs_dict,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception as e:
        logger.exception("AI extraction failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI service error: {e}")

    return result


# ── Duplicate detection endpoint ─────────────────────────────────────────────

@router.post("/check-hashes")
def check_hashes(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """
    Given a list of SHA-256 image hashes, return which ones already have a
    non-deleted note in the current user's library.
    """
    hashes = payload.get("hashes", [])
    if not hashes:
        return {"duplicates": {}}

    rows = (
        db.query(Note.image_hash, Note.id, Note.title)
        .filter(
            Note.image_hash.in_(hashes),
            Note.deleted_at.is_(None),
            Note.user_id == current_user,
        )
        .all()
    )
    duplicates = {
        row.image_hash: {"note_id": row.id, "title": row.title}
        for row in rows
    }
    return {"duplicates": duplicates}


# ── Batch extraction endpoint ─────────────────────────────────────────────────

def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _batch_save_note(result, mode: str, batch_id: str, course_id: Optional[str], user_id: str) -> str:
    """
    Persist one extraction result as a Note with its sections.
    Opens its own short-lived DB session so it can safely run inside a threadpool.
    Returns the new note's ID.
    """
    from database import SessionLocal
    db = SessionLocal()
    try:
        note = Note(
            user_id=user_id,
            title=result.suggested_title,
            extraction_mode=mode,
            ai_model_used=result.ai_model_used,
            course_id=course_id or None,
            batch_id=batch_id,
            image_hash=result.image_hash,
        )
        db.add(note)
        db.flush()
        for i, s in enumerate(result.sections):
            db.add(NoteSection(
                note_id=note.id,
                heading=s.heading,
                content_type=s.content_type,
                content=s.content,
                section_order=i,
            ))
        db.commit()
        db.refresh(note)
        return note.id
    finally:
        db.close()


@router.post("/batch")
async def batch_extract(
    files: list[UploadFile] = File(...),
    mode: str = Form("transcribe"),
    course_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    if mode not in ("transcribe", "study_guide"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid mode '{mode}'. Must be 'transcribe' or 'study_guide'.",
        )
    if not files:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No files provided.")
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum {MAX_BATCH_FILES} files per batch. You sent {len(files)}.",
        )

    file_data = []
    for f in files:
        raw = await f.read()
        file_data.append({
            "filename":     f.filename or "unknown",
            "content_type": (f.content_type or "").lower(),
            "bytes":        raw,
        })

    _check_daily_limit(db, current_user)
    corrections_dicts, prefs_dict = _load_user_context(db, current_user)

    batch_id = str(uuid.uuid4())
    mb_limit = settings.MAX_UPLOAD_BYTES // (1024 * 1024)

    async def event_stream():
        total     = len(file_data)
        succeeded = 0
        failed    = 0

        yield _sse("batch_start", {"batch_id": batch_id, "total": total})

        for i, fd in enumerate(file_data):
            filename = fd["filename"]
            yield _sse("file_start", {"index": i, "filename": filename, "total": total})

            try:
                if fd["content_type"] not in ALLOWED_MIME_TYPES:
                    raise ValueError(
                        f"Unsupported file type '{fd['content_type']}'. "
                        "Upload a JPEG, PNG, WebP, GIF, HEIC, or PDF."
                    )
                if len(fd["bytes"]) > settings.MAX_UPLOAD_BYTES:
                    raise ValueError(f"File exceeds the {mb_limit} MB limit.")
                if len(fd["bytes"]) == 0:
                    raise ValueError("File is empty.")

                result = await run_in_threadpool(
                    extract_note, fd["bytes"], mode, corrections_dicts, prefs_dict,
                )
                note_id = await run_in_threadpool(
                    _batch_save_note, result, mode, batch_id, course_id, current_user
                )

                succeeded += 1
                yield _sse("file_done", {
                    "index":      i,
                    "filename":   filename,
                    "note_id":    note_id,
                    "title":      result.suggested_title,
                    "confidence": result.confidence,
                })

            except Exception as exc:
                failed += 1
                logger.warning("Batch file %r failed: %s", filename, exc)
                yield _sse("file_error", {"index": i, "filename": filename, "error": str(exc)})

        yield _sse("batch_complete", {
            "batch_id":  batch_id,
            "succeeded": succeeded,
            "failed":    failed,
            "total":     total,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )
