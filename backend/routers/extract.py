"""
routers/extract.py — POST /api/extract

Receives an uploaded image, runs it through the AI extraction pipeline,
and returns structured content. Nothing is written to the database here.
The image bytes are used only within this request and then discarded.
"""

import json
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

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

MAX_BATCH_FILES = 20   # hard cap per batch request


@router.post("", response_model=ExtractionResult)
async def extract(
    file: UploadFile = File(...),
    mode: str = Form("transcribe"),
    db: Session = Depends(get_db),
):
    """
    Extract structured notes from an uploaded image.

    - Validates file type and size server-side (never trust the client).
    - Loads active corrections and user preferences to inject into the prompt.
    - Calls the AI provider, parses the response, and returns it.
    - The uploaded image is read into memory and never persisted.
    """
    # ── Validate mode ─────────────────────────────────────────────────────────
    if mode not in ("transcribe", "study_guide"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid mode '{mode}'. Must be 'transcribe' or 'study_guide'.",
        )

    # ── Validate file type ────────────────────────────────────────────────────
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{content_type}'. Upload a JPEG, PNG, WebP, or PDF.",
        )

    # ── Read and size-check ───────────────────────────────────────────────────
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

    # ── Load corrections and preferences ─────────────────────────────────────
    corrections = (
        db.query(Correction)
        .filter(Correction.active == True)
        .all()
    )
    corrections_dicts = [
        {
            "original_text":   c.original_text,
            "corrected_text":  c.corrected_text,
            "correction_type": c.correction_type,
            "context_hint":    c.context_hint,
        }
        for c in corrections
    ]

    prefs_row = db.query(UserPreferences).first()
    prefs_dict = (
        {
            "default_mode":            prefs_row.default_mode,
            "preferred_heading_style": prefs_row.preferred_heading_style,
            "preferred_bullet_style":  prefs_row.preferred_bullet_style,
            "extra_instructions":      prefs_row.extra_instructions,
        }
        if prefs_row else None
    )

    # ── Call extraction pipeline ──────────────────────────────────────────────
    try:
        result = extract_note(
            image_bytes=image_bytes,
            mode=mode,
            corrections=corrections_dicts,
            prefs=prefs_dict,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )
    except Exception as e:
        logger.exception("AI extraction failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI service error: {e}",
        )

    return result


# ── Duplicate detection endpoint ─────────────────────────────────────────────

@router.post("/check-hashes")
def check_hashes(
    payload: dict,
    db: Session = Depends(get_db),
):
    """
    Given a list of SHA-256 image hashes, return which ones already have a
    non-deleted note in the library.  Called by the frontend before upload
    so users can be warned about duplicate documents.

    Body: { "hashes": ["abc123...", ...] }
    Returns: { "duplicates": { "abc123...": { "note_id": "...", "title": "..." } } }
    """
    hashes = payload.get("hashes", [])
    if not hashes:
        return {"duplicates": {}}

    rows = (
        db.query(Note.image_hash, Note.id, Note.title)
        .filter(Note.image_hash.in_(hashes), Note.deleted_at.is_(None))
        .all()
    )
    duplicates = {
        row.image_hash: {"note_id": row.id, "title": row.title}
        for row in rows
    }
    return {"duplicates": duplicates}


# ── Batch extraction endpoint ─────────────────────────────────────────────────

def _sse(event: str, data: dict) -> str:
    """Format a single Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _batch_save_note(result, mode: str, batch_id: str, course_id: Optional[str]) -> str:
    """
    Persist one extraction result as a Note with its sections.
    Opens its own short-lived DB session so it can safely run inside
    a threadpool without sharing the request's session.
    Returns the new note's ID.
    """
    from database import SessionLocal
    db = SessionLocal()
    try:
        note = Note(
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
):
    """
    Accept multiple files and process them sequentially, streaming a
    Server-Sent Events response so the client can track per-file status
    in real time.

    Each file is validated, extracted, and saved as a Note independently.
    A file-level error does NOT abort the rest of the batch.

    SSE event types emitted:
      batch_start   — {batch_id, total}
      file_start    — {index, filename, total}
      file_done     — {index, filename, note_id, title, confidence}
      file_error    — {index, filename, error}
      batch_complete — {batch_id, succeeded, failed, total}
    """
    # ── Validate inputs ───────────────────────────────────────────────────────
    if mode not in ("transcribe", "study_guide"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid mode '{mode}'. Must be 'transcribe' or 'study_guide'.",
        )
    if not files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No files provided.",
        )
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum {MAX_BATCH_FILES} files per batch. You sent {len(files)}.",
        )

    # ── Read all file bytes upfront (async reads must happen before the generator) ──
    file_data = []
    for f in files:
        raw = await f.read()
        file_data.append({
            "filename":     f.filename or "unknown",
            "content_type": (f.content_type or "").lower(),
            "bytes":        raw,
        })

    # ── Load shared DB data now (while request session is open) ──────────────
    corrections = db.query(Correction).filter(Correction.active == True).all()
    corrections_dicts = [
        {
            "original_text":   c.original_text,
            "corrected_text":  c.corrected_text,
            "correction_type": c.correction_type,
            "context_hint":    c.context_hint,
        }
        for c in corrections
    ]
    prefs_row = db.query(UserPreferences).first()
    prefs_dict = (
        {
            "default_mode":            prefs_row.default_mode,
            "preferred_heading_style": prefs_row.preferred_heading_style,
            "preferred_bullet_style":  prefs_row.preferred_bullet_style,
            "extra_instructions":      prefs_row.extra_instructions,
        }
        if prefs_row else None
    )

    batch_id = str(uuid.uuid4())
    mb_limit = settings.MAX_UPLOAD_BYTES // (1024 * 1024)

    # ── SSE generator ─────────────────────────────────────────────────────────
    async def event_stream():
        total     = len(file_data)
        succeeded = 0
        failed    = 0

        yield _sse("batch_start", {"batch_id": batch_id, "total": total})

        for i, fd in enumerate(file_data):
            filename = fd["filename"]
            yield _sse("file_start", {"index": i, "filename": filename, "total": total})

            try:
                # Per-file validation (same rules as single-file endpoint)
                if fd["content_type"] not in ALLOWED_MIME_TYPES:
                    raise ValueError(
                        f"Unsupported file type '{fd['content_type']}'. "
                        "Upload a JPEG, PNG, WebP, GIF, HEIC, or PDF."
                    )
                if len(fd["bytes"]) > settings.MAX_UPLOAD_BYTES:
                    raise ValueError(f"File exceeds the {mb_limit} MB limit.")
                if len(fd["bytes"]) == 0:
                    raise ValueError("File is empty.")

                # Extract (sync — run in threadpool so we don't block the event loop)
                result = await run_in_threadpool(
                    extract_note,
                    fd["bytes"],
                    mode,
                    corrections_dicts,
                    prefs_dict,
                )

                # Save note (opens its own session inside the threadpool)
                note_id = await run_in_threadpool(
                    _batch_save_note, result, mode, batch_id, course_id
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
                yield _sse("file_error", {
                    "index":    i,
                    "filename": filename,
                    "error":    str(exc),
                })

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
            "X-Accel-Buffering": "no",   # disable nginx buffering for SSE
            "Connection":        "keep-alive",
        },
    )
