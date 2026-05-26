# Design Decisions — NoteSnap

This document describes three design decisions made during the development of NoteSnap, and reflects honestly on how much each was driven by me (the developer) vs shaped autonomously by Claude as an agentic coding tool.

---

## 1. Image section attachments as an escape hatch for noisy PDFs

**The decision:** Notes support a dedicated `image` section type. When editing a note, a user can insert a section, set its type to "image," and upload a photo directly. The image is stored server-side and its URL is saved in the section's content field, rather than embedding base64 data in the database.

**What was asked:** After seeing that PDF extraction was producing garbled output (slide number artifacts, misread symbols, formatting noise), I asked: *"is there a way to either attach a screenshot image while editing, or to not include nonsense characters?"* I explicitly named image attachment as one of two acceptable solutions.

**Who made the decision:** Mostly me. I identified both the problem (noisy extraction) and one of the solutions (image attachment). I also raised the follow-up concern about whether storing images server-side was safe for a production app — which shaped the decision to store URLs rather than blobs and to design the upload endpoint so it could later be pointed at S3 without changing section content. Claude handled the implementation details, but the feature direction and the production storage concern both came from me.

**Reflection:** This is a case where I was navigating a real tradeoff and Claude was executing my preferred path. The URL-vs-base64 storage design was a collaborative refinement, but the core idea — "let me just attach a photo instead of relying on noisy extraction" — was mine.

---

## 2. Tag filtering surfaced in the Library toolbar

**The decision:** The Library page has a dedicated row of filter controls (course, mode, tags). Tags are filterable via a dropdown that is always visible, not hidden behind a conditional render. An additional row of clickable tag chips appears below the toolbar when notes with tags exist, for quick selection.

**What was asked:** I explicitly requested this: *"I still don't see the 'tags' feature being used anywhere. In the library, allow the notes to be filtered by tag."* When the initial implementation hid the tag chips behind an `allTags.length > 0` check (making them invisible before any tags existed), I followed up specifically because I couldn't find the filter. I had also previously asked for tags to be part of the upload flow, not just added after the fact.

**Who made the decision:** Mostly me. I identified that the tags feature needed a visible, usable entry point in the Library — not just buried in the note detail editor. Claude's first implementation hid it conditionally; I pushed back and it became a persistent dropdown. I also directed that tag input during upload should work correctly (noticed it was silently dropped if you didn't press Enter before saving).

**Reflection:** The overall design philosophy here — tags should be first-class filters, not a hidden afterthought — came entirely from me. Claude implemented it competently but needed my direction to understand that discoverability was the actual requirement, not just technical presence of the feature.

---

## 3. A dedicated Study Tools page separate from the Library

**The decision:** Study materials (flashcards and practice questions) live on their own page (`/notes/:id/study`) rather than being embedded inside the note editor or tucked into a modal. A separate StudyHub page (`/study`) acts as a launchpad — listing all notes grouped by course, showing how many cards and questions each one has, and linking through to the study session. The two pages have distinct purposes: the Library is for reading and editing notes; Study Tools is for active recall practice.

**What was asked:** I asked for a study tools feature and gave specific direction on what it should contain and how it should behave — flashcards needed LaTeX rendering, practice questions needed to be formatted correctly with a single column of answer labels, and the hub needed to show whether study materials had already been generated for a note ("No study materials yet" vs the actual counts). I also flagged when things weren't working as expected, like the hub showing stale counts and the LaTeX not rendering.

**Who made the decision:** Mostly me. The separation of "browse notes" (Library) from "study notes" (StudyHub + StudyTools) reflects a product decision about how the app should feel — two distinct modes of interacting with your material. Claude implemented the pages and made lower-level decisions about component structure, but the concept of a dedicated study flow, and the expectation that it would show flashcard/question counts per note so I could see at a glance what was ready to study, came from my direction. The iterative feedback I gave (fix the labels, fix the LaTeX, show real counts) also shaped the final design significantly.

**Reflection:** This is a case where the high-level product vision was mine — I knew I wanted a study mode that felt separate from note-taking — and Claude filled in the structure. But the repeated feedback loop (several rounds of corrections to get the page working correctly) also meant I was continuously steering the implementation toward what I actually had in mind. The final page reflects my intent more than it reflects Claude's initial interpretation of it.
