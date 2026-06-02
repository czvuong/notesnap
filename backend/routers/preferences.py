"""
routers/preferences.py — /api/preferences

Per-user preferences. One row per user, keyed by user_id.
GET creates the row with defaults if it doesn't exist for this user yet.

Theme is stored as a plain VARCHAR column added via _run_migrations() in
database.py.  It is intentionally NOT in the SQLAlchemy model so that a
missing column (before the migration runs) never breaks the regular ORM
SELECT.  All theme reads/writes go through raw SQL helpers that catch DB
errors and fall back to the default gracefully.
"""

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from auth import get_current_user
from database import get_db
from models import UserPreferences
from schemas import PreferencesOut, PreferencesUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/preferences", tags=["preferences"])

VALID_THEMES = {"violet", "blue", "sage", "dark"}
DEFAULT_THEME = "violet"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_create_prefs(db: Session, user_id: str) -> UserPreferences:
    prefs = db.query(UserPreferences).filter(UserPreferences.user_id == user_id).first()
    if not prefs:
        prefs = UserPreferences(user_id=user_id)
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    return prefs


def _get_theme(db: Session, prefs_id: str) -> str:
    """
    Read theme via raw SQL so we degrade gracefully if the column doesn't
    exist yet (migration still pending).
    """
    try:
        row = db.execute(
            text("SELECT theme FROM user_preferences WHERE id = :id"),
            {"id": prefs_id},
        ).first()
        value = row[0] if row else None
        return value if value in VALID_THEMES else DEFAULT_THEME
    except Exception as exc:
        logger.warning("Could not read theme (column may not exist yet): %s", exc)
        db.rollback()
        return DEFAULT_THEME


def _set_theme(db: Session, prefs_id: str, theme: str) -> None:
    """
    Write theme via raw SQL.  No-op (with a warning) if column doesn't exist.
    """
    if theme not in VALID_THEMES:
        return
    try:
        db.execute(
            text("UPDATE user_preferences SET theme = :theme WHERE id = :id"),
            {"theme": theme, "id": prefs_id},
        )
        db.commit()
    except Exception as exc:
        logger.warning("Could not save theme (column may not exist yet): %s", exc)
        db.rollback()


def _to_out(p: UserPreferences, theme: str = DEFAULT_THEME) -> PreferencesOut:
    return PreferencesOut(
        id=p.id,
        default_mode=p.default_mode,
        preferred_heading_style=p.preferred_heading_style,
        preferred_bullet_style=p.preferred_bullet_style,
        extra_instructions=p.extra_instructions,
        theme=theme,
        updated_at=p.updated_at,
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=PreferencesOut)
def get_preferences(
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    prefs = _get_or_create_prefs(db, current_user)
    return _to_out(prefs, _get_theme(db, prefs.id))


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

    prefs.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(prefs)

    # Theme is handled separately via raw SQL
    if body.theme is not None:
        _set_theme(db, prefs.id, body.theme)

    return _to_out(prefs, _get_theme(db, prefs.id))
