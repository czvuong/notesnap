"""
routers/collaborators.py — Collaborative note sharing endpoints.

Permissions model:
  view    — read-only access to the specific note
  edit    — full section editing (same as owner, on that note only)
  comment — read + leave comments

Security guarantee: collaborators can ONLY access the note they were
invited to. The listNotes / listCourses endpoints still filter by
user_id == current_user, so the owner's other data is never exposed.

Invite flow:
  1. Owner POSTs {email, permission} → NoteCollaborator row created
  2. Invitee calls GET /api/me/shared-notes → system matches on email
     extracted from their JWT and returns the shared notes list
  3. invitee_user_id is backfilled on first match for faster lookups
"""

from datetime import datetime, timezone
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import get_current_user, get_current_user_info
from database import get_db
from models import Note, NoteCollaborator, NoteComment

router = APIRouter(tags=["collaborators"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CollaboratorCreate(BaseModel):
    email: str
    permission: str = "view"

    @field_validator("permission")
    @classmethod
    def _valid_permission(cls, v):
        if v not in ("view", "edit", "comment"):
            raise ValueError("permission must be view, edit, or comment")
        return v

    @field_validator("email")
    @classmethod
    def _lowercase_email(cls, v):
        return v.strip().lower()


class CollaboratorUpdate(BaseModel):
    permission: str

    @field_validator("permission")
    @classmethod
    def _valid_permission(cls, v):
        if v not in ("view", "edit", "comment"):
            raise ValueError("permission must be view, edit, or comment")
        return v


class CommentCreate(BaseModel):
    content: str
    user_name: Optional[str] = None


def _collab_out(c: NoteCollaborator) -> dict:
    return {
        "id":              c.id,
        "note_id":         c.note_id,
        "invitee_email":   c.invitee_email,
        "permission":      c.permission,
        "created_at":      c.created_at.isoformat(),
    }


def _comment_out(c: NoteComment) -> dict:
    return {
        "id":         c.id,
        "note_id":    c.note_id,
        "user_id":    c.user_id,
        "user_name":  c.user_name,
        "content":    c.content,
        "created_at": c.created_at.isoformat(),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _require_owner(db: Session, note_id: str, user_id: str) -> Note:
    """Get a note that MUST be owned by user_id. Raises 404 if missing/deleted."""
    note = db.query(Note).filter(
        Note.id == note_id,
        Note.user_id == user_id,
        Note.deleted_at == None,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    return note


# ── Collaborator CRUD ─────────────────────────────────────────────────────────

@router.post("/api/notes/{note_id}/collaborators")
def invite_collaborator(
    note_id: str,
    body: CollaboratorCreate,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """
    Invite a user by email to collaborate on a note.
    Only the note owner can invite. Duplicate invites update the permission.
    """
    note = _require_owner(db, note_id, current_user)

    # Prevent owners from inviting themselves
    # (We can't compare email without knowing the owner's email,
    # but we can check after the invitee_user_id is resolved.)

    # Always store email lowercase so matching is case-insensitive.
    normalized_email = body.email.strip().lower()

    existing = db.query(NoteCollaborator).filter(
        NoteCollaborator.note_id == note_id,
        NoteCollaborator.invitee_email == normalized_email,
    ).first()

    if existing:
        # Update permission if already invited
        existing.permission = body.permission
        db.commit()
        db.refresh(existing)
        return _collab_out(existing)

    collab = NoteCollaborator(
        note_id=note_id,
        owner_id=current_user,
        invitee_email=normalized_email,
        permission=body.permission,
        created_at=datetime.now(timezone.utc),
    )
    db.add(collab)
    db.commit()
    db.refresh(collab)
    return _collab_out(collab)


@router.get("/api/notes/{note_id}/collaborators")
def list_collaborators(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """List all collaborators on a note. Owner only."""
    _require_owner(db, note_id, current_user)
    collabs = db.query(NoteCollaborator).filter(
        NoteCollaborator.note_id == note_id,
    ).order_by(NoteCollaborator.created_at).all()
    return [_collab_out(c) for c in collabs]


@router.patch("/api/notes/{note_id}/collaborators/{collab_id}")
def update_collaborator(
    note_id: str,
    collab_id: str,
    body: CollaboratorUpdate,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """Change a collaborator's permission. Owner only."""
    _require_owner(db, note_id, current_user)
    collab = db.query(NoteCollaborator).filter(
        NoteCollaborator.id == collab_id,
        NoteCollaborator.note_id == note_id,
    ).first()
    if not collab:
        raise HTTPException(status_code=404, detail="Collaborator not found.")
    collab.permission = body.permission
    db.commit()
    db.refresh(collab)
    return _collab_out(collab)


@router.delete("/api/notes/{note_id}/collaborators/{collab_id}", status_code=204)
def remove_collaborator(
    note_id: str,
    collab_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """Remove a collaborator from a note. Owner only."""
    _require_owner(db, note_id, current_user)
    collab = db.query(NoteCollaborator).filter(
        NoteCollaborator.id == collab_id,
        NoteCollaborator.note_id == note_id,
    ).first()
    if not collab:
        raise HTTPException(status_code=404, detail="Collaborator not found.")
    db.delete(collab)
    db.commit()


# ── Debug ─────────────────────────────────────────────────────────────────────

@router.get("/api/me/debug")
def debug_identity(
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    """
    Returns the user_id and email the backend resolved for the current session.
    Use this to verify that email matching will work for shared-note lookups.
    """
    user_id, email = current_user_info
    pending_invites = db.query(NoteCollaborator).filter(
        NoteCollaborator.invitee_email == (email or ""),
        NoteCollaborator.invitee_user_id == None,
    ).count()
    matched_by_uid = db.query(NoteCollaborator).filter(
        NoteCollaborator.invitee_user_id == user_id,
    ).count()
    return {
        "user_id": user_id,
        "resolved_email": email,
        "email_source": "jwt" if email else "clerk_api_or_none",
        "pending_invites_by_email": pending_invites,
        "matched_invites_by_user_id": matched_by_uid,
    }


# ── Shared-with-me ────────────────────────────────────────────────────────────

@router.get("/api/me/shared-notes")
def get_shared_notes(
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    """
    Return notes shared WITH the current user (not notes the user owns).
    Matches on invitee_user_id (fast) OR invitee_email from JWT (slower, first access).
    On a match by email, backfills invitee_user_id for faster future lookups.
    """
    user_id, email = current_user_info

    # Build filter: match by already-resolved user_id OR by email from JWT
    filters = [NoteCollaborator.invitee_user_id == user_id]
    if email:
        filters.append(NoteCollaborator.invitee_email == email.lower())

    collabs = db.query(NoteCollaborator).filter(or_(*filters)).all()

    # Backfill invitee_user_id for any rows matched by email only
    for c in collabs:
        if c.invitee_user_id is None and user_id:
            c.invitee_user_id = user_id
    if collabs:
        db.commit()

    results = []
    for c in collabs:
        note = db.query(Note).filter(
            Note.id == c.note_id,
            Note.deleted_at == None,
        ).first()
        if note:
            results.append({
                "id":              note.id,
                "title":           note.title,
                "extraction_mode": note.extraction_mode,
                "created_at":      note.created_at.isoformat(),
                "updated_at":      note.updated_at.isoformat(),
                "permission":      c.permission,
                "owner_id":        c.owner_id,
                "collab_id":       c.id,
            })

    return results


# ── Comments ──────────────────────────────────────────────────────────────────

def _get_note_access(
    db: Session,
    note_id: str,
    user_id: str,
    email: Optional[str],
) -> Tuple[Note, str]:
    """
    Returns (note, permission_level) where permission_level is one of:
      "owner" | "edit" | "comment" | "view"
    Raises 404 if note doesn't exist or 403 if user has no access.
    """
    note = db.query(Note).filter(
        Note.id == note_id,
        Note.deleted_at == None,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")

    if note.user_id == user_id:
        return note, "owner"

    filters = [NoteCollaborator.invitee_user_id == user_id]
    if email:
        filters.append(NoteCollaborator.invitee_email == email.lower())

    collab = db.query(NoteCollaborator).filter(
        NoteCollaborator.note_id == note_id,
        or_(*filters),
    ).first()

    if not collab:
        raise HTTPException(status_code=403, detail="Access denied.")

    # Backfill user_id on first email-matched access
    if collab.invitee_user_id is None and user_id:
        collab.invitee_user_id = user_id
        db.commit()

    return note, collab.permission


@router.get("/api/notes/{note_id}/comments")
def list_comments(
    note_id: str,
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    """List all comments on a note. Requires any access level."""
    user_id, email = current_user_info
    _get_note_access(db, note_id, user_id, email)  # just for auth check

    comments = db.query(NoteComment).filter(
        NoteComment.note_id == note_id,
        NoteComment.deleted_at == None,
    ).order_by(NoteComment.created_at).all()

    return [_comment_out(c) for c in comments]


@router.post("/api/notes/{note_id}/comments")
def add_comment(
    note_id: str,
    body: CommentCreate,
    db: Session = Depends(get_db),
    current_user_info: Tuple[str, Optional[str]] = Depends(get_current_user_info),
):
    """
    Add a comment. Requires 'comment', 'edit', or 'owner' access.
    'view'-only collaborators cannot comment.
    """
    user_id, email = current_user_info
    note, permission = _get_note_access(db, note_id, user_id, email)

    if permission == "view":
        raise HTTPException(
            status_code=403,
            detail="View-only access does not allow commenting.",
        )

    comment = NoteComment(
        note_id=note_id,
        user_id=user_id,
        user_name=body.user_name,
        content=body.content,
        created_at=datetime.now(timezone.utc),
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return _comment_out(comment)


@router.delete("/api/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: str,
    db: Session = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """
    Soft-delete a comment. Users can only delete their own comments.
    Note owners can delete any comment on their note.
    """
    comment = db.query(NoteComment).filter(
        NoteComment.id == comment_id,
        NoteComment.deleted_at == None,
    ).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found.")

    # Check: own comment OR note owner
    note = db.query(Note).filter(Note.id == comment.note_id).first()
    is_owner = note and note.user_id == current_user
    if comment.user_id != current_user and not is_owner:
        raise HTTPException(status_code=403, detail="Cannot delete someone else's comment.")

    comment.deleted_at = datetime.now(timezone.utc)
    db.commit()
