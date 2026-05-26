"""
database.py — SQLAlchemy engine and session setup.

This module is the single point of truth for database connectivity.
All other modules import `get_db` (a FastAPI dependency that yields
a session) and `Base` (the declarative base all models inherit from).
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import StaticPool

from config import settings


# ── Engine ────────────────────────────────────────────────────────────────────
# StaticPool + check_same_thread=False are required for SQLite in a threaded
# web server context. For Postgres in production you'd remove both.
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

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


def init_db():
    """
    Create all tables if they don't already exist.
    Called once at application startup.
    In production you'd use Alembic migrations instead.
    """
    # Import models here so Base is aware of them before create_all
    import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
