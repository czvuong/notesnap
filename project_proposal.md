## Title
NoteSnap Production Launch

## One Sentence Description
A public, multi-user app that scans uploaded notes and produces study material, shipped with auth, per-user isolation, and a live URL (Ship it with auth + live URL).

## Past Project Reference 
I will build off of Assignment 2: Document Scanner. Github link: https://github.com/ucsd-cse-genai-programming-sp26/02-doc-scanner-czvuong-assignment-2.

## Planned Technologies
- Frontend: React 18 + Vite (existing)
- Frontend deployment: Vercel
- Backend: FastAPI + Python 3.11 (existing)
- Backend deployment: Railway
- Database: PostgreSQL on Railway (migrating from SQLite)
- Auth: Clerk (handles Google OAuth, email/password, session tokens, and React hooks)
- AI pipeline: TritonAI (existing OCR + structuring models), Anthropic Claude as fallback
- Background jobs: APScheduler for soft-delete cleanup (existing)

## First Deliverable
A logged-in user can upload a photo of their notes, have them extracted by the AI pipeline, and see the saved results in their own personal library (isolated from all other users' data). 

This single workflow forces every major part of the proposed system to work end-to-end. Specifically, Clerk auth on the frontend (login), JWT verification on the backend, PostgreSQL in place of SQLite, per-user data scoping on all DB queries, the existing AI pipeline gated behind auth, and a deployed live URL on Railway + Vercel. 

## Rough Architecture for First Deliverable
1. Authentication and sessions

    I plan to use Clerk for login, including both Google OAuth and email login. The React app will check if the user is signed in before showing the application. Once the user is signed in, the frontend will send their session token with requests to the backend.

- Input: User login/signup information
- Output: A logged-in user session
- Effect: Only authenticated users can access their private main NoteSnap workflow

2. Backend user verification

    The FastAPI backend will verify the user session on protected routes. After verification, each request will have access to the current user's ID, which will be used when saving or fetching data.

- Input: API request with a user session token
- Output: Current user ID or an error
- Effect: Unauthenticated users cannot access the application

3. User-owned database schema

    The existing database will be updated so notes and related data belong to a specific user. I plan to move from local SQLite to PostgreSQL for deployment. At minimum, notes, courses, tags, preferences, and corrections will need a `user_id`. Flashcards and practice questions don't need their own `user_id`, as they are already tied to a user through their parent note.  

- Input: Existing NoteSnap database models
- Output: User-scoped database tables
- Effect: Each user's notes and settings are stored separately

    A simplified version of the data model:

    ```text
    notes
    - id
    - user_id
    - course_id
    - title 
    - extraction_mode
    - confidence
    - created_at
    - updated_at

    sections
    - id
    - note_id
    - type
    - content
    - order_index

    courses
    - id 
    - user_id
    - name

    tags
    - id
    - user_id
    - name

    note_tags
    - note_id
    - tag_id
    ```

4. Authenticated upload and extraction flow

    The existing upload/extraction pipeline will mostly stay the same, but will only be available to logged-in users. A student uploads an image or text-based PDF, chooses an extraction mode (transcription or study guide), and the backend runs the OCR + LLM structuring pipeline to return an editable draft note.

- Input: Uploaded file, extraction mode, current user ID
- Output: Structured note draft with title, sections, and warnings
- Effect: Turns the uploaded document into editable text 

5. Save note workflow

    After reviewing the extraction result, the user can save the note to their account. The backend will save the note, its sections, selected course, and tags using the current user ID.

- Input: Edited extraction result, course/tags, current user ID
- Output: Saved note object
- Effect: The note becomes part of that user's library

6. User-scoped library

    The Library page will fetch only the notes owned by the logged-in user. Existing filters like course, tag, extraction mode, search, and sort can still work, but they will operate only within that user's notes.

- Input: Current user ID and optional filters/search parameters
- Output: List of that user's notes
- Effect: Users can browse their own saved notes without seeing anyone else's data

7. Deployment and basic usage limits

    For the first deliverable, I want the app to be deployable with a real frontend, backend, database, and environment-variable-based secrets. I also want to add a simple usage limit, such as a daily upload limit per user, so the live app cannot accidentally run unlimited OCR/LLM calls.

- Input: User extraction request
- Output: Allowed or blocked request based on usage
- Effect: Makes the public version safer to run

## After First Deliverable Goals
- Study tools scoped per user: Flashcard generation and practice question generation works, but need to add `user_id` column and all queries filtered
- User preferences scoped per user: The `user_preferences` singleton becomes one row per user
- Soft delete + trash scoped per user: Trash view only shows the current user's deleted items, and restore should be user-scoped
- Custom domain: Point a real domain at the Vercel deployment
- Public shareable note links: Opt-in toggle that generates a read-only public URL to share a note (accessible without login) 
- Mobile-responsive UI: Add responsive breakpoints for phone-sized screens
- Admin usage dashboard: A private page (admin-only Clerk role) showing total users, total extractions this week, and estimated AI cost 