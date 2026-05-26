# Design Decisions — NoteSnap

This document describes three design decisions made during the development of this application, and reflects on how much each was driven by me vs. Claude (my chosen agentic coding tool). 

---

## 1. Image section attachments as an escape hatch for noisy PDFs

**The decision:** Notes support a dedicated `image` section type. When editing a note, a user can insert a section, set its type to "image," and upload a photo directly. The image is stored server-side and its URL is saved in the section's content field, rather than embedding base64 data in the database.

**What was asked:** After seeing that PDF extraction was producing garbled output (slide number artifacts, misread symbols, formatting noise), I asked: *"is there a way to either attach a screenshot image while editing, or to not include nonsense characters?"* I explicitly named image attachment as one of two acceptable solutions.

**Who made the decision:** Mostly me. I identified both the problem (noisy extraction) and one of the solutions (image attachment). I also raised the follow-up concern about whether storing images server-side was safe for a production app — which shaped the decision to store URLs rather than blobs and to design the upload endpoint so it could later be pointed at S3 without changing section content. Claude handled the implementation details, but the feature direction and the production storage concern both came from me.

---

## 2. Tag filtering surfaced in the Library toolbar

**The decision:** The Library page has a dedicated row of filter controls (course, mode, tags). Tags are filterable via a dropdown that is always visible, not hidden behind a conditional render. An additional row of clickable tag chips appears below the toolbar when notes with tags exist, for quick selection.

**What was asked:** I explicitly requested having a 'tags' feature and allowing users to filter by tag. This allows users to choose a topic to study by, rather than only being able to filter by course. I followed up as well when I didn't see the 'tags' feature being used anywhere on the application. 

**Who made the decision:** Mostly me. I identified that the tags feature needed a visible, usable entry point in the Library — not just buried in the note detail editor. Claude's first implementation hid it conditionally; I pushed back and it became a persistent dropdown. I also directed that tag input during upload should work correctly (noticed it was silently dropped if you didn't press Enter before saving).

---

## 3. A dedicated Study Tools page separate from the Library

**The decision:** Study materials (flashcards and practice questions) live on their own page (`/notes/:id/study`) rather than being embedded inside the note editor or tucked into a modal. A separate StudyHub page (`/study`) acts as a launchpad — listing all notes grouped by course, showing how many cards and questions each one has, and linking through to the study session. The two pages have distinct purposes: the Library is for reading and editing notes; Study Tools is for active recall practice.

**What was asked:** I asked for a study tools feature and gave specific direction on what it should contain and how it should behave — flashcards needed LaTeX rendering, practice questions needed to be formatted correctly with a single column of answer labels, and the hub needed to show whether study materials had already been generated for a note ("No study materials yet" vs the actual counts). I also flagged when things weren't working as expected, like the hub showing stale counts and the LaTeX not rendering.

**Who made the decision:** Mostly me. The separation of "browse notes" (Library) from "study notes" (StudyHub + StudyTools) reflects a product decision about how the app should feel — two distinct modes of interacting with your material. Claude implemented the pages and made lower-level decisions about component structure, but the concept of a dedicated study flow, and the expectation that it would show flashcard/question counts per note so I could see at a glance what was ready to study, came from my direction. The iterative feedback I gave (fix the labels, fix the LaTeX, show real counts) also shaped the final design significantly.

---

## 4. Adding a warning if users upload a duplicate

**The decision:** If a user uploads a file that has already been uploaded, the system displays a warning indicating that the file is a duplicate. The user is then given the option to either cancel the upload or proceed anyway. 

**Who made the decision:** I revisited the handling of duplicate uploads after receiving feedback about caching OCR results to avoid redundant API calls. This led me to consider the user experience: in most cases, students are unlikely to intentionally upload the same document multiple times (except possibly when using different modes). As a result, I decided to introduce a warning for duplicate uploads to prevent accidental redundancy while still allowing flexibility. Claude implemented this behavior in the codebase.     

---

## 5. Adding batch upload

**The decision:** I chose to implement batch upload functionality, allowing users to upload multiple documents at once. This feature aligns well with the primary use case of the application, since students often work with multiple pages of notes from a single lecture or study session. Supporting batch uploads makes the workflow more efficient and reduces the friction of uploading documents one at a time.

**What had to change:** A new `batch_id` column was added to the `Note` model and passed through the schema and save logic. The extract router gained a new `POST /api/extract/batch` endpoint that fans out extractions in parallel using `asyncio.gather`. The Library page gained a `batch_id` filter and a clickable 'Batch' icon on note cards for users to view the batch post-upload. 

**What didn't change:** The single upload page, the two-stage extraction pipeline, the section schema, and flashcards/practice questions were all untouched. The batch path reuses the exact same extraction logic, it just calls it N times in parallel and tags the results. 

**Who made the decision:** I decided to proceed with batch uploads as the new feature after considering the expected user behavior and how the app would be used in practice. I also specified that uploaded documents should be grouped together, with the option for users to ungroup them if needed. Claude implemented this functionality in the codebase.   
