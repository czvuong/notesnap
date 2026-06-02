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
    Errors are caught and silently skipped (e.g. SQLite dev environment).
    """
    migrations = [
        # Added: per-user theme preference (violet / blue / sage / dark)
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS "
        "theme VARCHAR(20) NOT NULL DEFAULT 'violet'",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                conn.rollback()


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
