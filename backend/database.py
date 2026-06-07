"""
database.py — SQLAlchemy engine and session setup.

This module is the single point of truth for database connectivity.
All other modules import `get_db` (a FastAPI dependency that yields
a session) and `Base` (the declarative base all models inherit from).
"""

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import StaticPool

from config import settings


# ── Engine ────────────────────────────────────────────────────────────────────
# SQLite requires StaticPool + check_same_thread=False for threaded servers.
# PostgreSQL uses the default pool with no extra connect_args.
if settings.DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
else:
    engine = create_engine(settings.DATABASE_URL)

# ── Session factory ───────────────────────────────────────────────────────────
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ── Declarative base ──────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    """All ORM models inherit from this."""
    pass


# ── FastAPI dependency ────────────────────────────────────────────────────────
def get_db():
    """
    Yields a database session for use in a FastAPI route.
    Guarantees the session is closed even if the route raises an exception.

    Usage in a route:
        def my_route(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _run_migrations():
    """
    Lightweight inline migrations for columns added after initial deploy.
    Uses ADD COLUMN IF NOT EXISTS (PostgreSQL 9.6+) so it's safe to run
    on every startup — it is a no-op when the column already exists.
    Errors are logged and skipped (e.g. SQLite dev environment).
    """
    import logging
    logger = logging.getLogger(__name__)

    migrations = [
        # Added: per-user theme preference (violet / blue / sage / dark)
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS "
        "theme VARCHAR(20) NOT NULL DEFAULT 'violet'",
        # Added: public sharing — is_public flag and URL slug per note
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS "
        "is_public BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE notes ADD COLUMN IF NOT EXISTS "
        "public_slug VARCHAR(32) UNIQUE",
        # Added: content_hash for tool-generation caching.
        # Stores SHA-256 of the note's section text at generation time so that
        # repeated generate calls skip the LLM when the content hasn't changed.
        # Nullable so existing rows are treated as stale (regenerated once, then cached).
        "ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS "
        "content_hash VARCHAR(64)",
        "ALTER TABLE practice_questions ADD COLUMN IF NOT EXISTS "
        "content_hash VARCHAR(64)",
        # Added: content_hash for study session caching.
        # SHA-256 of sorted combined note content + tool. Prevents duplicate sessions
        # from being created when the user generates the same session multiple times.
        "ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS "
        "content_hash VARCHAR(64)",
        # Added: collaborative note sharing.
        # note_collaborators — per-note invite records (email + permission level)
        # note_comments      — comments left by collaborators / owner
        """CREATE TABLE IF NOT EXISTS note_collaborators (
            id               TEXT PRIMARY KEY,
            note_id          TEXT NOT NULL REFERENCES notes(id),
            owner_id         TEXT NOT NULL,
            invitee_email    TEXT NOT NULL,
            invitee_user_id  TEXT,
            permission       TEXT NOT NULL DEFAULT 'view',
            created_at       DATETIME NOT NULL,
            UNIQUE(note_id, invitee_email)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_nc_note_id        ON note_collaborators(note_id)",
        "CREATE INDEX IF NOT EXISTS ix_nc_invitee_email  ON note_collaborators(invitee_email)",
        "CREATE INDEX IF NOT EXISTS ix_nc_invitee_uid    ON note_collaborators(invitee_user_id)",
        """CREATE TABLE IF NOT EXISTS note_comments (
            id         TEXT PRIMARY KEY,
            note_id    TEXT NOT NULL REFERENCES notes(id),
            user_id    TEXT NOT NULL,
            user_name  TEXT,
            content    TEXT NOT NULL,
            created_at DATETIME NOT NULL,
            deleted_at DATETIME
        )""",
        "CREATE INDEX IF NOT EXISTS ix_ncmt_note_id ON note_comments(note_id)",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
                logger.info("Migration OK: %s", sql[:60])
            except Exception as exc:
                conn.rollback()
                logger.warning("Migration skipped (%s): %s", type(exc).__name__, exc)


def init_db():
    """
    Create all tables if they don't already exist, then apply inline migrations.
    Called once at application startup.
    In production you'd use Alembic migrations instead.
    """
    # Import models here so Base is aware of them before create_all
    import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _run_migrations()
