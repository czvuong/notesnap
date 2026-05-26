"""
routers/images.py — Image upload endpoint.

Accepts an image file, saves it to the static/images directory, and returns
a URL that the frontend can store in a section's content field.
"""

import os
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File

router = APIRouter(prefix="/api/images", tags=["images"])

# ── Storage path ──────────────────────────────────────────────────────────────
# Resolve relative to this file so it works regardless of cwd.
_HERE       = os.path.dirname(os.path.abspath(__file__))
_IMAGES_DIR = os.path.join(_HERE, "..", "static", "images")

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    """
    Upload an image file and return its served URL.
    The URL is stored as the section content for image-type sections.
    """
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type: {file.content_type}. Allowed: jpeg, png, gif, webp.",
        )

    data = await file.read()
    if len(data) > _MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large ({len(data) // 1024} KB). Maximum is 10 MB.",
        )

    os.makedirs(_IMAGES_DIR, exist_ok=True)

    # Use a UUID filename to avoid collisions
    ext = (file.filename or "image").rsplit(".", 1)[-1].lower()
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    dest = os.path.join(_IMAGES_DIR, filename)

    with open(dest, "wb") as f:
        f.write(data)

    return {"url": f"/static/images/{filename}"}
