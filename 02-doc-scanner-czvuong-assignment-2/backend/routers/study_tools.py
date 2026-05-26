"""
routers/study_tools.py — /api/notes/{id}/flashcards, practice-questions, summary
"""

from datetime import datetime, timezone
import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from extraction import (
    generate_course_summary,
    generate_flashcards_from_text,
    generate_practice_questions_from_text,
)
from models import Course, Flashcard, FlashcardReview, Note, NoteSection, PracticeQuestion
from schemas import (
    FlashcardOut,
    FlashcardReviewCreate,
    FlashcardReviewOut,
    MessageOut,
    PracticeQuestionOut,
)

router = APIRouter(tags=["study-tools"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_note(db: Session, note_id: str) -> Note:
    note = db.query(Note).filter(Note.id == note_id, Note.deleted_at == None).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    return note

def _sections_text(note: Note) -> str:
    """Concatenate a note's active sections into a single string for AI input."""
    parts = []
    for s in sorted(note.sections, key=lambda x: x.section_order):
        if s.deleted_at is not None:
            continue
        heading = f"## {s.heading}\n" if s.heading else ""
        parts.append(f"{heading}{s.content}")
    return "\n\n".join(parts)


# ── Flashcards ────────────────────────────────────────────────────────────────

@router.post("/api/notes/{note_id}/flashcards/generate", response_model=list[FlashcardOut])
def generate_flashcards(note_id: str, db: Session = Depends(get_db)):
    """Generate and persist flashcards for a note using its section content."""
    note = _get_note(db, note_id)
    text = _sections_text(note)
    if not text.strip():
        raise HTTPException(status_code=422, detail="Note has no content to generate flashcards from.")

    cards_data = generate_flashcards_from_text(text)
    if not cards_data:
        raise HTTPException(status_code=502, detail="AI did not return any flashcards.")

    new_cards = []
    for card in cards_data:
        fc = Flashcard(
            note_id=note.id,
            front=card["front"],
            back=card["back"],
        )
        db.add(fc)
        new_cards.append(fc)

    db.commit()
    for fc in new_cards:
        db.refresh(fc)

    return [_fc_out(fc) for fc in new_cards]


@router.get("/api/notes/{note_id}/flashcards", response_model=list[FlashcardOut])
def list_flashcards(note_id: str, db: Session = Depends(get_db)):
    _get_note(db, note_id)
    cards = db.query(Flashcard).filter(
        Flashcard.note_id == note_id, Flashcard.deleted_at == None
    ).order_by(Flashcard.created_at).all()
    return [_fc_out(fc) for fc in cards]


@router.post("/api/flashcards/{flashcard_id}/review", response_model=FlashcardReviewOut)
def review_flashcard(
    flashcard_id: str,
    body: FlashcardReviewCreate,
    db: Session = Depends(get_db),
):
    """Log a flashcard review result (known / partial / missed)."""
    fc = db.query(Flashcard).filter(
        Flashcard.id == flashcard_id, Flashcard.deleted_at == None
    ).first()
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
def generate_questions(note_id: str, db: Session = Depends(get_db)):
    """Generate and persist practice questions for a note."""
    note = _get_note(db, note_id)
    text = _sections_text(note)
    if not text.strip():
        raise HTTPException(status_code=422, detail="Note has no content to generate questions from.")

    questions_data = generate_practice_questions_from_text(text)
    if not questions_data:
        raise HTTPException(status_code=502, detail="AI did not return any questions.")

    new_qs = []
    for q in questions_data:
        pq = PracticeQuestion(
            note_id=note.id,
            question_text=q["question_text"],
            answer_text=q["answer_text"],
            question_type=q.get("question_type", "short_answer"),
            options=json.dumps(q["options"]) if q.get("options") else None,
        )
        db.add(pq)
        new_qs.append(pq)

    db.commit()
    for pq in new_qs:
        db.refresh(pq)

    return [_pq_out(pq) for pq in new_qs]


@router.get("/api/notes/{note_id}/practice-questions", response_model=list[PracticeQuestionOut])
def list_questions(note_id: str, db: Session = Depends(get_db)):
    _get_note(db, note_id)
    qs = db.query(PracticeQuestion).filter(
        PracticeQuestion.note_id == note_id, PracticeQuestion.deleted_at == None
    ).order_by(PracticeQuestion.created_at).all()
    return [_pq_out(q) for q in qs]


# ── Course summary ────────────────────────────────────────────────────────────

@router.post("/api/courses/{course_id}/summary/generate")
def generate_summary(course_id: str, db: Session = Depends(get_db)):
    """Generate a plain-text summary across all notes in a course. Not persisted."""
    course = db.query(Course).filter(
        Course.id == course_id, Course.deleted_at == None
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")

    notes = db.query(Note).filter(
        Note.course_id == course_id, Note.deleted_at == None
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
