"""
routers/courses.py — /api/courses
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import Course, Note
from schemas import CourseCreate, CourseOut, CourseUpdate, MessageOut, SoftDeleteOut

router = APIRouter(prefix="/api/courses", tags=["courses"])


def _course_or_404(db: Session, course_id: str) -> Course:
    course = db.query(Course).filter(
        Course.id == course_id, Course.deleted_at == None
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")
    return course

def _to_out(course: Course, db: Session) -> CourseOut:
    note_count = db.query(Note).filter(
        Note.course_id == course.id, Note.deleted_at == None
    ).count()
    return CourseOut(
        id=course.id,
        name=course.name,
        description=course.description,
        color_hex=course.color_hex,
        created_at=course.created_at,
        updated_at=course.updated_at,
        note_count=note_count,
    )


@router.get("", response_model=list[CourseOut])
def list_courses(db: Session = Depends(get_db)):
    courses = db.query(Course).filter(Course.deleted_at == None).order_by(Course.name).all()
    return [_to_out(c, db) for c in courses]


@router.post("", response_model=CourseOut, status_code=status.HTTP_201_CREATED)
def create_course(body: CourseCreate, db: Session = Depends(get_db)):
    course = Course(name=body.name, description=body.description, color_hex=body.color_hex)
    db.add(course)
    db.commit()
    db.refresh(course)
    return _to_out(course, db)


@router.get("/{course_id}", response_model=CourseOut)
def get_course(course_id: str, db: Session = Depends(get_db)):
    course = _course_or_404(db, course_id)
    return _to_out(course, db)


@router.patch("/{course_id}", response_model=CourseOut)
def update_course(course_id: str, body: CourseUpdate, db: Session = Depends(get_db)):
    course = _course_or_404(db, course_id)
    if body.name is not None:
        course.name = body.name
    if body.description is not None:
        course.description = body.description
    if body.color_hex is not None:
        course.color_hex = body.color_hex
    course.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(course)
    return _to_out(course, db)


@router.delete("/{course_id}", response_model=SoftDeleteOut)
def delete_course(course_id: str, db: Session = Depends(get_db)):
    """
    Soft-delete a course. Notes in it become unorganized (course_id set to null)
    rather than being deleted themselves.
    """
    course = _course_or_404(db, course_id)
    now = datetime.now(timezone.utc)
    course.deleted_at = now

    # Unassign notes rather than deleting them
    db.query(Note).filter(Note.course_id == course.id).update({"course_id": None})

    db.commit()
    return SoftDeleteOut(
        id=course.id,
        deleted_at=now,
        restores_until=now + timedelta(days=settings.SOFT_DELETE_TTL_DAYS),
    )
