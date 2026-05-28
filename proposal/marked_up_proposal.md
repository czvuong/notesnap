## Title
NoteSnap Production Launch

## One Sentence Description
A public, multi-user app that scans uploaded notes and produces study material, shipped with auth, per-user isolation, and a live URL (Ship it with auth + live URL).

## Past Project Reference
I will build off of Assignment 2: Document Scanner. Github link: https://github.com/ucsd-cse-genai-programming-sp26/02-doc-scanner-czvuong-assignment-2.

---

## Planned Technologies

- **Frontend: React 18 + Vite (existing)**
  > ✅ Implemented as written. `frontend/src/` — React 18 with Vite, react-router-dom v6, and Clerk's React SDK integrated in `frontend/src/App.jsx`.

- **Frontend deployment: Vercel**
  > ✅ Implemented as written. Deployed at https://04-student-choice-czvuong-assignmen.vercel.app. `frontend/vercel.json` adds a catch-all rewrite for React Router SPA routing.

- **Backend: FastAPI + Python 3.11 (existing)**
  > ✅ Implemented as written. `backend/main.py` — FastAPI app with all routers registered; Python 3.13 used (upgrade from 3.11, same API).

- **Backend deployment: Railway**
  > ✅ Implemented as written. Deployed at https://04-student-choice-czvuong-assignment-4-production.up.railway.app. `backend/Procfile` starts Uvicorn on the Railway-injected `$PORT`.

- **Database: PostgreSQL on Railway (migrating from SQLite)**
  > ✅ Implemented as written. Railway Postgres plugin provisioned; `DATABASE_URL` injected as an environment variable. SQLite still used for local dev (configured via `backend/config.py`).

- **Auth: Clerk (handles Google OAuth, email/password, session tokens, and React hooks)**
  > ✅ Implemented as written. `backend/auth.py` verifies Clerk JWTs via JWKS; `get_current_user` FastAPI dependency used on all protected routes. Frontend wraps the app in `<ClerkProvider>` and uses `useUser()` to access the signed-in user.

- **AI pipeline: TritonAI (existing OCR + structuring models), Anthropic Claude as fallback**
  > ✅ Implemented as written. `backend/extraction.py` — two-step pipeline (OCR → structuring) using TritonAI models configured in `backend/config.py`. Anthropic Claude available as an alternate provider via `AI_PROVIDER=anthropic`.

- **Background jobs: APScheduler for soft-delete cleanup (existing)**
  > ✅ Implemented as written. `backend/main.py` — APScheduler runs `_purge_expired_soft_deletes` every 24 hours to permanently remove rows soft-deleted longer than the TTL.

---

## First Deliverable

A logged-in user can upload a photo of their notes, have them extracted by the AI pipeline, and see the saved results in their own personal library (isolated from all other users' data).

This single workflow forces every major part of the proposed system to work end-to-end. Specifically, Clerk auth on the frontend (login), JWT verification on the backend, PostgreSQL in place of SQLite, per-user data scoping on all DB queries, the existing AI pipeline gated behind auth, and a deployed live URL on Railway + Vercel.

> ✅ Implemented as written. The full end-to-end workflow is live at the Vercel URL: sign in → upload → extract → save → library. All components described (Clerk auth, JWT verification, PostgreSQL, per-user scoping, deployed URL) are in place.

---

## Rough Architecture for First Deliverable

**1. Authentication and sessions**

I plan to use Clerk for login, including both Google OAuth and email login. The React app will check if the user is signed in before showing the application. Once the user is signed in, the frontend will send their session token with requests to the backend.

- Input: User login/signup information
- Output: A logged-in user session
- Effect: Only authenticated users can access their private main NoteSnap workflow

> ✅ Implemented as written. Clerk's `<SignedIn>` / `<SignedOut>` components gate the app in `frontend/src/App.jsx`. `frontend/src/api.js` attaches the Bearer token from `useAuth().getToken()` to every request.

---

**2. Backend user verification**

The FastAPI backend will verify the user session on protected routes. After verification, each request will have access to the current user's ID, which will be used when saving or fetching data.

- Input: API request with a user session token
- Output: Current user ID or an error
- Effect: Unauthenticated users cannot access the application

> ✅ Implemented as written. `backend/auth.py` — `get_current_user` dependency fetches Clerk's JWKS, verifies the JWT signature, and returns the `sub` claim (Clerk user ID). All protected routers use `current_user: str = Depends(get_current_user)`.

---

**3. User-owned database schema**

The existing database will be updated so notes and related data belong to a specific user. I plan to move from local SQLite to PostgreSQL for deployment. At minimum, notes, courses, tags, preferences, and corrections will need a `user_id`. Flashcards and practice questions don't need their own `user_id`, as they are already tied to a user through their parent note.

- Input: Existing NoteSnap database models
- Output: User-scoped database tables
- Effect: Each user's notes and settings are stored separately

> ✅ Implemented as written. `backend/models.py` — `user_id` column added to `Note`, `Course`, `Tag`, `Correction`, `UserPreferences`, `Flashcard`, and `PracticeQuestion`. The data model matches the schema outlined in the proposal. PostgreSQL is used in production via Railway.

---

**4. Authenticated upload and extraction flow**

The existing upload/extraction pipeline will mostly stay the same, but will only be available to logged-in users. A student uploads an image or text-based PDF, chooses an extraction mode (transcription or study guide), and the backend runs the OCR + LLM structuring pipeline to return an editable draft note.

- Input: Uploaded file, extraction mode, current user ID
- Output: Structured note draft with title, sections, and warnings
- Effect: Turns the uploaded document into editable text

> ✅ Implemented as written. `backend/routers/extract.py` — `POST /api/extract` requires `get_current_user` and passes the user ID through to daily-limit checking and note creation.

---

**5. Save note workflow**

After reviewing the extraction result, the user can save the note to their account. The backend will save the note, its sections, selected course, and tags using the current user ID.

- Input: Edited extraction result, course/tags, current user ID
- Output: Saved note object
- Effect: The note becomes part of that user's library

> ✅ Implemented as written. `backend/routers/notes.py` — `POST /api/notes` saves note + sections with the current user ID; course and tag assignment also scoped to that user.

---

**6. User-scoped library**

The Library page will fetch only the notes owned by the logged-in user. Existing filters like course, tag, extraction mode, search, and sort can still work, but they will operate only within that user's notes.

- Input: Current user ID and optional filters/search parameters
- Output: List of that user's notes
- Effect: Users can browse their own saved notes without seeing anyone else's data

> ✅ Implemented as written. `backend/routers/notes.py` — all list queries filter by `Note.user_id == current_user`. Course, tag, search, sort, and pagination filters operate within that user's notes only.

---

**7. Deployment and basic usage limits**

For the first deliverable, I want the app to be deployable with a real frontend, backend, database, and environment-variable-based secrets. I also want to add a simple usage limit, such as a daily upload limit per user, so the live app cannot accidentally run unlimited OCR/LLM calls.

- Input: User extraction request
- Output: Allowed or blocked request based on usage
- Effect: Makes the public version safer to run

> ✅ Implemented as written. Deployed on Railway (backend) and Vercel (frontend) with secrets managed through environment variables. `backend/config.py` — `DAILY_EXTRACTION_LIMIT=30`; `backend/routers/extract.py` checks the per-user daily count before running the AI pipeline and returns HTTP 429 if the limit is exceeded.

---

## After First Deliverable Goals

- **Study tools scoped per user: Flashcard generation and practice question generation works, but need to add `user_id` column and all queries filtered**
  > ✅ Implemented. `backend/models.py` — `Flashcard` and `PracticeQuestion` both have `user_id`. `backend/routers/study_tools.py` filters all queries by `current_user`.

- **User preferences scoped per user: The `user_preferences` singleton becomes one row per user**
  > ✅ Implemented. `backend/models.py` — `UserPreferences` has `user_id`; `backend/routers/preferences.py` upserts one row per user. Theme preference is additionally persisted client-side in `frontend/src/hooks/useTheme.js`, scoped to `notesnap_theme_<userId>` in localStorage so switching accounts restores that account's theme.

- **Soft delete + trash scoped per user: Trash view only shows the current user's deleted items, and restore should be user-scoped**
  > ✅ Implemented. `backend/routers/trash.py` — all trash list, restore, and purge operations filter by `current_user`.

- **Custom domain: Point a real domain at the Vercel deployment**
  > ❌ No longer planned. The app is live and fully functional at the Vercel subdomain. A custom domain adds no functionality for the assignment.

- **Public shareable note links: Opt-in toggle that generates a read-only public URL to share a note (accessible without login)**
  > ❌ Not yet implemented. Per-user isolation was the focus for this initial submission. May implement after the review session.  

- **Mobile-responsive UI: Add responsive breakpoints for phone-sized screens**
  > ❌ Not yet implemented. Could be useful for users to use from their phone, so will likely implement after the initial submission. 

- **Admin usage dashboard: A private page (admin-only Clerk role) showing total users, total extractions this week, and estimated AI cost**
  > ⚠️ Partially implemented. `backend/routers/costs.py` — `GET /api/costs` and `GET /api/costs/summary` expose cost log data and per-model breakdowns. The full admin UI page with Clerk role-gating was not built, but the underlying data is queryable via the API.
