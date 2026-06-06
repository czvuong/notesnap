"""
routers/study_tools.py — /api/notes/{id}/flashcards, practice-questions, summary,
                          /api/study-session/generate (multi-note ephemeral sessions)

All routes require authentication and are scoped to the current user.
"""

from datetime import datetime, timezone
import hashlib
import json
import logging
from typing import Literal

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from extraction import (
    generate_course_summary,
    generate_flashcards_from_text,
    generate_practice_questions_from_text,
)
from models import Course, Flashcard, FlashcardReview, Note, NoteSection, PracticeQuestion, StudySession
from schemas import (
    FlashcardOut,
    FlashcardReviewCreate,
    FlashcardReviewOut,
    MessageOut,
    PracticeQuestionOut,
    StudySessionOut,
)


class StudySessionRequest(BaseModel):
    note_ids: list[str]
    tool: Literal["flashcards", "practice_questions"]

router = APIRouter(tags=["study-tools"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_note(db: Session, note_id: str, user_id: str) -> Note:
    note = db.query(Note).filter(
        Note.id == note_id, Note.deleted_at == None, Note.user_id == user_id
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    return note

def _sections_text(note: Note) -> str:
    parts = []
    for s in sorted(note.sections, key=lambda x: x.section_order):
        if s.deleted_at is not None:
            continue
        heading = f"## {s.heading}\n" if s.heading else ""
        parts.append(f"{heading}{s.content}")
    return "\n\n".join(parts)


def _content_hash(text: str) -> str:
    """
    Compute a stable SHA-256 fingerprint of section text.

    Used as a cache key for flashcard and practice-question generation.
    When a note's sections are edited, the hash changes and the next
    generate call will skip the cache and call the LLM with fresh content.
    Old cached rows are soft-deleted at that point so the DB stays tidy.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ── Flashcards ────────────────────────────────────────────────────────────────

@router.post("/api/notes/{note_id}/flashcards/generate", response_model=list[FlashcardOut])
def generate_flashcards(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    note = _get_note(db, note_id, current_user)
    text = _sections_text(note)
    if not text.strip():
        raise HTTPException(status_code=422, detail="Note has no content to generate flashcards from.")

    current_hash = _content_hash(text)

    # ── Cache check ──────────────────────────────────────────────────────────
    # If flashcards already exist for this exact content, return them without
    # calling the LLM. The hash changes whenever sections are edited, so this
    # is safe — stale cards are cleaned up below on a cache miss.
    cached = db.query(Flashcard).filter(
        Flashcard.note_id == note_id,
        Flashcard.deleted_at == None,
        Flashcard.content_hash == current_hash,
    ).order_by(Flashcard.created_at).all()

    if cached:
        logger.info(
            "Flashcard cache hit for note %s (hash=%s…, %d cards)",
            note_id, current_hash[:12], len(cached),
        )
        return [_fc_out(fc) for fc in cached]

    # ── Cache miss — generate fresh flashcards ───────────────────────────────
    logger.info("Flashcard cache miss for note %s — calling LLM", note_id)
    cards_data = generate_flashcards_from_text(text)
    if not cards_data:
        raise HTTPException(status_code=502, detail="AI did not return any flashcards.")

    # Soft-delete any stale flashcards (wrong hash or no hash = pre-cache rows)
    now = datetime.now(timezone.utc)
    stale = db.query(Flashcard).filter(
        Flashcard.note_id == note_id,
        Flashcard.deleted_at == None,
    ).all()
    for fc in stale:
        fc.deleted_at = now

    new_cards = []
    for card in cards_data:
        fc = Flashcard(
            note_id=note.id,
            front=card["front"],
            back=card["back"],
            content_hash=current_hash,
        )
        db.add(fc)
        new_cards.append(fc)

    db.commit()
    for fc in new_cards:
        db.refresh(fc)
    return [_fc_out(fc) for fc in new_cards]


@router.get("/api/notes/{note_id}/flashcards", response_model=list[FlashcardOut])
def list_flashcards(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    _get_note(db, note_id, current_user)
    cards = db.query(Flashcard).filter(
        Flashcard.note_id == note_id, Flashcard.deleted_at == None
    ).order_by(Flashcard.created_at).all()
    return [_fc_out(fc) for fc in cards]


@router.post("/api/flashcards/{flashcard_id}/review", response_model=FlashcardReviewOut)
def review_flashcard(
    flashcard_id: str,
    body: FlashcardReviewCreate,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    # Verify ownership via the parent note
    fc = (
        db.query(Flashcard)
        .join(Note, Note.id == Flashcard.note_id)
        .filter(
            Flashcard.id == flashcard_id,
            Flashcard.deleted_at == None,
            Note.user_id == current_user,
        ).first()
    )
    if not fc:
        raise HTTPException(status_code=404, detail="Flashcard not found.")

    review = FlashcardReview(flashcard_id=fc.id, result=body.result)
    db.add(review)
    db.commit()
    db.refresh(review)
    return FlashcardReviewOut(
        id=review.id,
        flashcard_id=review.flashcard_id,
        result=review.result,
        reviewed_at=review.reviewed_at,
    )


# ── Practice questions ────────────────────────────────────────────────────────

@router.post("/api/notes/{note_id}/practice-questions/generate", response_model=list[PracticeQuestionOut])
def generate_questions(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    note = _get_note(db, note_id, current_user)
    text = _sections_text(note)
    if not text.strip():
        raise HTTPException(status_code=422, detail="Note has no content to generate questions from.")

    current_hash = _content_hash(text)

    # ── Cache check ──────────────────────────────────────────────────────────
    cached = db.query(PracticeQuestion).filter(
        PracticeQuestion.note_id == note_id,
        PracticeQuestion.deleted_at == None,
        PracticeQuestion.content_hash == current_hash,
    ).order_by(PracticeQuestion.created_at).all()

    if cached:
        logger.info(
            "Practice question cache hit for note %s (hash=%s…, %d questions)",
            note_id, current_hash[:12], len(cached),
        )
        return [_pq_out(pq) for pq in cached]

    # ── Cache miss — generate fresh questions ────────────────────────────────
    logger.info("Practice question cache miss for note %s — calling LLM", note_id)
    questions_data = generate_practice_questions_from_text(text)
    if not questions_data:
        raise HTTPException(status_code=502, detail="AI did not return any questions.")

    # Soft-delete stale questions (wrong hash or pre-cache NULL hash rows)
    now = datetime.now(timezone.utc)
    stale = db.query(PracticeQuestion).filter(
        PracticeQuestion.note_id == note_id,
        PracticeQuestion.deleted_at == None,
    ).all()
    for pq in stale:
        pq.deleted_at = now

    new_qs = []
    for q in questions_data:
        pq = PracticeQuestion(
            note_id=note.id,
            question_text=q["question_text"],
            answer_text=q["answer_text"],
            question_type=q.get("question_type", "short_answer"),
            options=json.dumps(q["options"]) if q.get("options") else None,
            content_hash=current_hash,
        )
        db.add(pq)
        new_qs.append(pq)

    db.commit()
    for pq in new_qs:
        db.refresh(pq)
    return [_pq_out(pq) for pq in new_qs]


@router.get("/api/notes/{note_id}/practice-questions", response_model=list[PracticeQuestionOut])
def list_questions(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    _get_note(db, note_id, current_user)
    qs = db.query(PracticeQuestion).filter(
        PracticeQuestion.note_id == note_id, PracticeQuestion.deleted_at == None
    ).order_by(PracticeQuestion.created_at).all()
    return [_pq_out(q) for q in qs]


# ── Course summary ────────────────────────────────────────────────────────────

@router.post("/api/courses/{course_id}/summary/generate")
def generate_summary(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    course = db.query(Course).filter(
        Course.id == course_id, Course.deleted_at == None, Course.user_id == current_user
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")

    notes = db.query(Note).filter(
        Note.course_id == course_id, Note.deleted_at == None, Note.user_id == current_user
    ).all()
    if not notes:
        raise HTTPException(status_code=422, detail="No notes in this course.")

    combined = "\n\n---\n\n".join(
        f"# {n.title}\n\n" + "\n\n".join(
            s.content for s in n.sections if s.deleted_at is None
        )
        for n in notes
    )
    summary = generate_course_summary(combined, course.name)
    return {"summary": summary}


# ── Multi-note study sessions ─────────────────────────────────────────────────

def _session_out(s: StudySession) -> StudySessionOut:
    return StudySessionOut(
        id=s.id,
        note_ids=json.loads(s.note_ids),
        note_titles=json.loads(s.note_titles),
        tool=s.tool,
        items=json.loads(s.items),
        created_at=s.created_at,
    )


@router.post("/api/study-session/generate", response_model=StudySessionOut)
def generate_study_session(
    body: StudySessionRequest,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    notes = db.query(Note).filter(
        Note.id.in_(body.note_ids),
        Note.deleted_at == None,
        Note.user_id == current_user,
    ).all()
    if not notes:
        raise HTTPException(status_code=404, detail="No valid notes found.")

    # Sort by ID so that selecting notes in a different order produces the same hash.
    notes_sorted = sorted(notes, key=lambda n: n.id)

    combined = "\n\n---\n\n".join(
        f"# {n.title}\n\n{_sections_text(n)}" for n in notes_sorted
    )

    # Include the tool in the hash so flashcard and question sessions on the
    # same notes are cached independently.
    current_hash = _content_hash(combined + body.tool)

    # ── Cache check ──────────────────────────────────────────────────────────
    # If a session already exists for this exact combination of notes + tool +
    # content, return it without calling the LLM. This prevents the duplicate
    # sessions that accumulate when the user clicks "Generate" multiple times.
    cached_session = db.query(StudySession).filter(
        StudySession.user_id == current_user,
        StudySession.tool == body.tool,
        StudySession.content_hash == current_hash,
        StudySession.deleted_at == None,
    ).order_by(StudySession.created_at.desc()).first()

    if cached_session:
        logger.info(
            "Study session cache hit (tool=%s, hash=%s…)",
            body.tool, current_hash[:12],
        )
        return _session_out(cached_session)

    # ── Cache miss — generate a new session ──────────────────────────────────
    logger.info("Study session cache miss (tool=%s) — calling LLM", body.tool)

    if body.tool == "flashcards":
        items = generate_flashcards_from_text(combined)
        if not items:
            raise HTTPException(status_code=502, detail="AI did not return any flashcards.")
    else:
        items = generate_practice_questions_from_text(combined)
        if not items:
            raise HTTPException(status_code=502, detail="AI did not return any questions.")

    session = StudySession(
        user_id=current_user,
        note_ids=json.dumps([n.id for n in notes_sorted]),
        note_titles=json.dumps([n.title for n in notes_sorted]),
        tool=body.tool,
        items=json.dumps(items),
        content_hash=current_hash,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_out(session)


@router.get("/api/study-sessions", response_model=list[StudySessionOut])
def list_study_sessions(
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    sessions = db.query(StudySession).filter(
        StudySession.deleted_at == None,
        StudySession.user_id == current_user,
    ).order_by(StudySession.created_at.desc()).all()
    return [_session_out(s) for s in sessions]


@router.delete("/api/study-sessions/{session_id}", response_model=MessageOut)
def delete_study_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    s = db.query(StudySession).filter(
        StudySession.id == session_id,
        StudySession.deleted_at == None,
        StudySession.user_id == current_user,
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found.")
    s.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return MessageOut(message="Session deleted.")


# ── Serializers ───────────────────────────────────────────────────────────────

def _fc_out(fc: Flashcard) -> FlashcardOut:
    return FlashcardOut(
        id=fc.id,
        note_id=fc.note_id,
        source_section_id=fc.source_section_id,
        front=fc.front,
        back=fc.back,
        created_at=fc.created_at,
    )

def _pq_out(pq: PracticeQuestion) -> PracticeQuestionOut:
    return PracticeQuestionOut(
        id=pq.id,
        note_id=pq.note_id,
        question_text=pq.question_text,
        answer_text=pq.answer_text,
        question_type=pq.question_type,
        options=pq.options,
        created_at=pq.created_at,
    )
