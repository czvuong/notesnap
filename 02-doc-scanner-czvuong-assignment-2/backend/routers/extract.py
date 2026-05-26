"""
routers/extract.py — POST /api/extract

Receives an uploaded image, runs it through the AI extraction pipeline,
and returns structured content. Nothing is written to the database here.
The image bytes are used only within this request and then discarded.
"""

import logging
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from extraction import extract_note
from models import Correction, UserPreferences
from schemas import ExtractionResult

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/extract", tags=["extraction"])

ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/jpg", "image/png",
    "image/gif", "image/webp", "image/heic",
    "application/pdf",
}


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
