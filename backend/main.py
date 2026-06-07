"""
main.py — FastAPI application entry point.

Responsibilities:
  - Create the FastAPI app with metadata
  - Register CORS middleware
  - Mount all routers
  - Initialize the database on startup
  - Start the background soft-delete cleanup job
"""

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from database import SessionLocal, init_db
from models import Course, Flashcard, Note, NoteSection, PracticeQuestion
from routers import corrections, costs, courses, extract, images, preferences, sections, study_tools, tags, trash
from routers import notes as notes_router
from routers import collaborators as collaborators_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ── Background cleanup job ────────────────────────────────────────────────────

def _purge_expired_soft_deletes():
    """
    Permanently remove rows that have been soft-deleted for longer than TTL.
    Runs once daily. Order matters: sections before notes (foreign keys).
    SectionRevisions are intentionally excluded — they are a permanent audit log.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.SOFT_DELETE_TTL_DAYS)
    db = SessionLocal()
    try:
        deleted_counts = {}

        for model, label in [
            (NoteSection,     "sections"),
            (Flashcard,       "flashcards"),
            (PracticeQuestion,"practice_questions"),
            (Note,            "notes"),
            (Course,          "courses"),
        ]:
            rows = db.query(model).filter(
                model.deleted_at != None,
                model.deleted_at < cutoff,
            ).all()
            for row in rows:
                db.delete(row)
            deleted_counts[label] = len(rows)

        db.commit()
        logger.info("Soft-delete purge complete: %s", deleted_counts)
    except Exception:
        logger.exception("Soft-delete purge failed")
        db.rollback()
    finally:
        db.close()


# ── App lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database...")
    init_db()
    logger.info("Database ready.")

    # Probe Clerk JWKS at startup so any auth misconfiguration is immediately visible.
    if settings.CLERK_SECRET_KEY:
        try:
            from auth import _get_jwks
            _get_jwks.cache_clear()
            keys = _get_jwks()
            logger.info("Clerk JWKS probe OK — %d key(s) loaded.", len(keys.get("keys", [])))
        except Exception as exc:
            logger.error("Clerk JWKS probe FAILED (%s): %s", type(exc).__name__, exc)
    else:
        logger.warning("CLERK_SECRET_KEY not set — running in dev mode (no auth).")

    scheduler = BackgroundScheduler()
    scheduler.add_job(_purge_expired_soft_deletes, "interval", hours=24, id="purge_job")
    scheduler.start()
    logger.info("Background scheduler started.")

    yield

    # Shutdown
    scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="NoteSnap API",
    description="Document scanning and study tool API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow explicitly listed origins (e.g. localhost for dev) plus any
# Vercel preview/production deployment URL for this project via regex.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=r"https://04-student-choice-czvuong.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files (uploaded images)
_static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(_static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=_static_dir), name="static")

# Routers
app.include_router(extract.router)
app.include_router(notes_router.router)
app.include_router(sections.router)
app.include_router(courses.router)
app.include_router(tags.router)
app.include_router(corrections.router)
app.include_router(study_tools.router)
app.include_router(trash.router)
app.include_router(preferences.router)
app.include_router(images.router)
app.include_router(costs.router)
app.include_router(collaborators_router.router)


@app.get("/api/health")
def health():
    """Simple health check — confirms the server is running."""
    return {"status": "ok"}
