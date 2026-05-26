"""
routers/tags.py — /api/tags

Returns all tags that exist in the database (i.e. have been added to at least
one note). Used by the Library page to render the tag filter chip row.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import Tag
from schemas import TagOut

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagOut])
def list_tags(db: Session = Depends(get_db)):
    """Return all tags, ordered alphabetically by name."""
    return db.query(Tag).order_by(Tag.name).all()
