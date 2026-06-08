# Review Plan

This file summarizes the feedback I received from peer reviewers and the course staff, and documents my response plan for each item.

---

## Peer Review — Reviewer 1 (Nathan)

**Feedback: Combine the two-stage AI pipeline into a single call to reduce cost.**

The reviewer suggested forcing a structured output directly from the OCR model to eliminate the second LLM call.

**Response:** The current two-stage design is intentional and already cost-efficient. The first stage (`api-lightonocr-1b`) has no input cost and charges only for output tokens; the second stage (`api-gpt-oss-120b`) operates on text only, avoiding more expensive image tokens. Merging both stages into one would require the OCR model to produce structured output (section types, titles, formatting), which it is not capable of reliably doing. The Anthropic fallback path already uses a single model for both steps, which satisfies the spirit of this suggestion in that context.

**Verdict: No change needed. Already addressed via the Anthropic provider path.**

---

**Feedback: Allow users to convert already-transcribed notes to flashcards.**

The reviewer suggested passing the structured JSON from an existing note through the flashcard pipeline directly.

**Response:** This is already supported. Users can generate flashcards or practice questions from any saved note in their Library via the Study Hub. No additional work required.

**Verdict: Already implemented. No change needed.**

---

## Peer Review — Reviewer 2 (Phuoc)

**Feedback: Cache the OCR result by image hash to avoid re-running the first API call on duplicate uploads.**

The reviewer noted that the same image always produces the same raw OCR text, so hashing the file and caching the result could skip one full API round trip on repeat uploads.

**Response:** Implemented. The backend now hashes uploaded images and caches OCR output. If the same image is uploaded again, the first-stage call is skipped and the cached text is reused. The frontend also detects the duplicate and shows a warning, letting the user cancel or continue. Relevant commit linked in `FEEDBACK-RESPONSE.md`.

**Verdict: Implemented.**

---

## Staff Feedback

**Feedback: Mobile-responsive UI was listed as a goal.**

The staff noted that mobile responsiveness was listed under "After First Deliverable Goals" and wanted to see it addressed.

**Response:** Implemented. `@media` breakpoints were added across all major pages: `App.css` (sidebar collapses on small screens), `Library.css`, `NoteEditor.css`, `Upload.css`, `StudyHub.css`, `BatchUpload.css`, `Courses.css`, `Dashboard.css`, and `PublicNoteView.css`. The sidebar nav collapses to an icon-only strip on narrow viewports.

**Verdict: Implemented.**

---

**Feedback: Collaborative sharing was a stretch goal.**

The staff flagged the collaborative sharing feature (Feature 3) as something to implement if time allowed.

**Response:** Fully implemented. The system supports invite-by-email with three permission levels (view, comment, edit), a `NoteCollaborator` table, threaded `NoteComment` support, permission-aware rendering throughout NoteEditor, and a "Shared with me" section in the Library. Details are documented in the "Features Added Beyond the Original Proposal" section of `final_marked_up_proposal.md`.

**Verdict: Implemented.**

---

**Feedback: Consider caching study tool results to avoid regenerating on every view.**

The staff suggested that flashcards and practice questions should not be regenerated on every page load.

**Response:** Implemented. All three study tool endpoints (flashcards, practice questions, summary) return cached results by default on subsequent calls. Results are stored in the database and re-served without hitting the AI pipeline. A `force=True` query parameter and a "New set" button in the frontend allow users to explicitly request a fresh generation when they want variety.

**Verdict: Implemented.**

---

**Feedback: Show a low-confidence warning when OCR quality is uncertain, with a manual override.**

The staff suggested surfacing a warning when the model is not confident in its extraction, and letting users override or correct it.

**Response:** The existing corrections system (`backend/routers/corrections.py`) allows users to submit manual corrections on any note section, and those corrections are logged and fed back into future extractions as examples. A more explicit confidence score surfaced in the UI was not implemented — the model does not currently emit a structured confidence signal that could be displayed. This remains a potential improvement for a future version.

**Verdict: Partially addressed via the corrections workflow. Explicit confidence UI not implemented.**
