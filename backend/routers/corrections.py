"""
routers/corrections.py — /api/corrections

User-approved corrections that get injected into future AI prompts.
These use hard delete (not soft) since they are preferences, not content.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Correction
from schemas import CorrectionCreate, CorrectionOut, CorrectionUpdate, MessageOut

router = APIRouter(prefix="/api/corrections", tags=["corrections"])


@router.get("", response_model=list[CorrectionOut])
def list_corrections(db: Session = Depends(get_db)):
    """Return all corrections (both active and inactive) for the preferences page."""
    corrections = db.query(Correction).order_by(Correction.created_at.desc()).all()
    return [_to_out(c) for c in corrections]


@router.post("", response_model=CorrectionOut, status_code=status.HTTP_201_CREATED)
def create_correction(body: CorrectionCreate, db: Session = Depends(get_db)):
    """Save a user-approved correction to influence future extractions."""
    correction = Correction(
        section_id=body.section_id,
        original_text=body.original_text,
        corrected_text=body.corrected_text,
        correction_type=body.correction_type,
        context_hint=body.context_hint,
        active=True,
    )
    db.add(correction)
    db.commit()
    db.refresh(correction)
    return _to_out(correction)


@router.patch("/{correction_id}", response_model=CorrectionOut)
def update_correction(
    correction_id: str, body: CorrectionUpdate, db: Session = Depends(get_db)
):
    """Toggle a correction active/inactive or update its context hint."""
    correction = _get_or_404(db, correction_id)
    if body.active is not None:
        correction.active = body.active
    if body.context_hint is not None:
        correction.context_hint = body.context_hint
    db.commit()
    db.refresh(correction)
    return _to_out(correction)


@router.delete("/{correction_id}", response_model=MessageOut)
def delete_correction(correction_id: str, db: Session = Depends(get_db)):
    """Hard-delete a correction. Corrections are user preferences, not content."""
    correction = _get_or_404(db, correction_id)
    db.delete(correction)
    db.commit()
    return MessageOut(message="Correction deleted.")


def _get_or_404(db: Session, correction_id: str) -> Correction:
    c = db.query(Correction).filter(Correction.id == correction_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Correction not found.")
    return c

def _to_out(c: Correction) -> CorrectionOut:
    return CorrectionOut(
        id=c.id,
        section_id=c.section_id,
        original_text=c.original_text,
        corrected_text=c.corrected_text,
        correction_type=c.correction_type,
        context_hint=c.context_hint,
        active=c.active,
        created_at=c.created_at,
    )
