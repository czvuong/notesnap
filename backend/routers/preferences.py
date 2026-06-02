"""
routers/preferences.py — /api/preferences

Per-user preferences. One row per user, keyed by user_id.
GET creates the row with defaults if it doesn't exist for this user yet.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import UserPreferences
from schemas import PreferencesOut, PreferencesUpdate

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


def _get_or_create_prefs(db: Session, user_id: str) -> UserPreferences:
    prefs = db.query(UserPreferences).filter(UserPreferences.user_id == user_id).first()
    if not prefs:
        prefs = UserPreferences(user_id=user_id)
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    return prefs


@router.get("", response_model=PreferencesOut)
def get_preferences(
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    return _to_out(_get_or_create_prefs(db, current_user))


@router.patch("", response_model=PreferencesOut)
def update_preferences(
    body: PreferencesUpdate,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    prefs = _get_or_create_prefs(db, current_user)
    if body.default_mode is not None:
        prefs.default_mode = body.default_mode
    if body.preferred_heading_style is not None:
        prefs.preferred_heading_style = body.preferred_heading_style
    if body.preferred_bullet_style is not None:
        prefs.preferred_bullet_style = body.preferred_bullet_style
    if "extra_instructions" in body.model_fields_set:
        prefs.extra_instructions = body.extra_instructions
    if body.theme is not None:
        prefs.theme = body.theme
    prefs.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(prefs)
    return _to_out(prefs)


def _to_out(p: UserPreferences) -> PreferencesOut:
    return PreferencesOut(
        id=p.id,
        default_mode=p.default_mode,
        preferred_heading_style=p.preferred_heading_style,
        preferred_bullet_style=p.preferred_bullet_style,
        extra_instructions=p.extra_instructions,
        theme=getattr(p, "theme", "violet") or "violet",
        updated_at=p.updated_at,
    )
