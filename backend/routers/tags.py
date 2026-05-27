"""
routers/tags.py — /api/tags

Returns the current user's tags. Used by the Library page for the tag filter.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Tag
from schemas import TagOut

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagOut])
def list_tags(
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """Return all tags for the current user, ordered alphabetically."""
    return db.query(Tag).filter(Tag.user_id == current_user).order_by(Tag.name).all()
