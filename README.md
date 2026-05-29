# Assignment 4: Student Choice

See the [assignment page](https://ucsd-cse-115-215.github.io/sp26/assignments/a4-assignment.html) for full requirements.

---

# NoteSnap

NoteSnap is an AI-powered document scanning and study tool that transforms photos of handwritten notes, whiteboards, and lecture slides into structured, searchable digital notes. It uses a two-step AI pipeline — a lightweight OCR model for text extraction followed by a large language model for structuring — to produce organized sections with properly rendered LaTeX equations. Notes are organized by course, tagged, and can be converted into flashcards and practice questions for active studying.

## Live Deployment

| Service | URL |
|---------|-----|
| Frontend (Vercel) | https://04-notesnap.vercel.app |
| Backend API (Railway) | https://04-notesnap.up.railway.app |
| API docs | https://04-notesnap.up.railway.app/docs |

Sign in with a UCSD Google account or any email via Clerk. All notes, courses, tags, and preferences are fully isolated per user — two accounts share nothing.

## Demo

📹 [Youtube Link](https://youtu.be/DrD4JY3oTgE)

## Features

- **Upload & extract** — JPEG, PNG, HEIC, and text-based PDF support
- **Two extraction modes** — Transcribe (faithful reproduction) and Study Guide (reorganized with key concepts surfaced)
- **Structured sections** — text, bullet lists, KaTeX-rendered equations, diagram descriptions, and image attachments
- **Course organization** — group notes by course
- **Tags** — freeform tagging and filtering across notes
- **Flashcard generation** — AI-generated front/back cards from any note
- **Practice questions** — short-answer Q&A generated from note content
- **Study Tools hub** — browse and search all notes across courses
- **Soft delete with trash** — 7-day restore window; permanent purge runs nightly
- **Version history** — every section edit is stored as an immutable revision
- **Batch upload** — upload multiple documents at once, processed in parallel; results are grouped under a shared batch ID and browsable as a filtered view in the Library
- **Duplicate detection** — files are hashed client-side (SHA-256) before upload; if a matching document already exists in the library, a blocking modal appears before extraction begins
- **OCR result cache** — repeated uploads of the same image skip the OCR API call entirely; cache holds up to 200 entries with FIFO eviction
- **Per-user isolation** — every note, course, tag, and preference is scoped to the authenticated user; accounts are fully independent
- **Cost ceiling** — daily AI extraction limit (30 extractions/day) to cap TritonAI usage per user

## Setup (Local Development)

### Prerequisites

- Python 3.11+
- Node.js 18+
- A TritonAI API key (UCSD SSO)

### 1. Clone the repo

```bash
git clone https://github.com/ucsd-cse-115-215/04-student-choice-czvuong-assignment-4.git
cd 04-student-choice-czvuong-assignment-4
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your API key
```

### 3. Frontend

```bash
cd frontend
npm install
```

### Environment Variables

#### Backend (`backend/.env`) — local dev only, never committed

| Variable | Value |
|----------|-------|
| `TRITONAI_API_KEY` | Your TritonAI key (UCSD SSO) |
| `TRITONAI_BASE_URL` | `https://tritonai-api.ucsd.edu/v1` |
| `TRITONAI_OCR_MODEL` | `api-lightonocr-1b` |
| `TRITONAI_TEXT_MODEL` | `api-gpt-oss-120b` |
| `TRITONAI_VISION_MODEL` | `api-mistral-small-3.2-2506` |
| `DATABASE_URL` | `sqlite:///./notesnap.db` |
| `CORS_ORIGINS` | `http://localhost:5173` |
| `CLERK_SECRET_KEY` | Leave blank — skips auth in dev mode |
| `CLERK_PUBLISHABLE_KEY` | Leave blank in dev mode |
| `CLERK_JWKS_URL` | Leave blank in dev mode |

#### Frontend (`frontend/.env`) — local dev only, never committed

| Variable | Value |
|----------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Your Clerk publishable key (or leave blank in dev) |
| `VITE_API_BASE` | `http://localhost:8000` |

> **Dev mode:** If `CLERK_SECRET_KEY` is blank, the backend skips JWT verification and returns a hardcoded `dev_user` ID. All routes work without a Clerk account.

### Running the App

Start both servers — they need to run simultaneously.

```bash
# Terminal 1 — backend
cd backend
source .venv/bin/activate
uvicorn main:app --reload
# Runs at http://localhost:8000
# Interactive API docs at http://localhost:8000/docs

# Terminal 2 — frontend
cd frontend
npm run dev
# Runs at http://localhost:5173
```

The Vite dev server proxies `/api` requests to `localhost:8000` automatically.

> **Dev mode note:** If `CLERK_SECRET_KEY` is left blank in `backend/.env`, the backend skips JWT verification and uses a hardcoded `dev_user` ID. This lets you develop locally without a Clerk account.

## Usage

- **Upload** — go to Upload, drop a photo of handwritten notes, a whiteboard, or a lecture slide (JPEG, PNG, HEIC, or text-based PDF). Choose Transcribe to reproduce the content faithfully or Study Guide to have the AI reorganize it into clean study notes.
- **Review** — after extraction, review the AI-generated sections before saving. Assign a course, add tags, and edit any sections that need correction.
- **Library** — all saved notes appear in the Library, filterable by course, tag, and extraction mode. Click any note to open the full editor, where you can edit sections, view version history, and restore previous content.
- **Study Tools** — from any note, generate flashcards or short-answer practice questions. The Study Tools hub lets you browse all notes across courses and launch study sessions.
- **Batch Upload** — go to Batch Upload and drag in multiple files at once. Assign a course, choose a mode, and click Upload. Each file shows its own progress indicator and any per-file errors appear inline without blocking the rest. When the batch finishes, a "View batch" button appears in the Library header so you can jump straight to that group. On the single Upload page, if the file you drop matches one already in your library, a modal asks whether to proceed or cancel before extraction begins.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite, react-router-dom v6 |
| Auth | Clerk (JWT, JWKS verification) |
| Math rendering | KaTeX |
| Icons | lucide-react |
| Frontend hosting | Vercel |
| Backend | FastAPI, Python 3.11+ |
| Database | PostgreSQL (Railway) — SQLite for local dev |
| Validation | Pydantic v2, pydantic-settings |
| Backend hosting | Railway |
| AI — OCR | TritonAI api-lightonocr-1b |
| AI — Structuring | TritonAI api-gpt-oss-120b |
| AI — Vision fallback | TritonAI api-mistral-small-3.2-2506 |
| PDF extraction | pypdf |
| Background jobs | APScheduler |

## Production Deployment

The app is deployed as two separate services:

**Backend (Railway)**
- FastAPI + Uvicorn, started via `Procfile`: `web: uvicorn main:app --host 0.0.0.0 --port $PORT`
- PostgreSQL database provisioned as a Railway plugin; `DATABASE_URL` is injected automatically
- Clerk JWT verification via JWKS endpoint (`CLERK_JWKS_URL`)
- CORS configured to allow the stable Vercel production domain plus a regex for Vercel preview deployments

**Frontend (Vercel)**
- Vite build; root directory set to `frontend/`
- `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_BASE` set as Vercel environment variables
- `vercel.json` catch-all rewrite routes all paths to `index.html` for React Router

**Railway environment variables (backend):**

| Variable | Where to get it |
|----------|----------------|
| `TRITONAI_API_KEY` | UCSD SSO → TritonAI dashboard |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys |
| `CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys |
| `CLERK_JWKS_URL` | `https://<your-instance>.clerk.accounts.dev/.well-known/jwks.json` |
| `DATABASE_URL` | Auto-injected by the Railway Postgres plugin |
| `CORS_ORIGINS` | `https://04-student-choice-czvuong-assignmen.vercel.app` |

**Vercel environment variables (frontend):**

| Variable | Where to get it |
|----------|----------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys |
| `VITE_API_BASE` | Your Railway backend URL (no trailing slash) |

## Project Structure

```
04-student-choice-czvuong-assignment-4/
├── backend/
│   ├── main.py               # App entry point, CORS, router registration
│   ├── config.py             # Pydantic settings (reads .env)
│   ├── auth.py               # Clerk JWT verification (JWKS-based)
│   ├── models.py             # SQLAlchemy ORM models
│   ├── schemas.py            # Pydantic request/response schemas
│   ├── extraction.py         # AI pipeline (OCR → structuring)
│   ├── prompts.py            # All prompt templates
│   ├── database.py           # DB session factory
│   ├── Procfile              # Railway start command
│   ├── static/images/        # Uploaded section images (served at /static/)
│   ├── requirements.txt
│   └── routers/
│       ├── extract.py        # POST /api/extract, POST /api/extract/batch, POST /api/extract/check-hashes
│       ├── notes.py          # CRUD for notes
│       ├── sections.py       # CRUD for sections + revision history
│       ├── courses.py        # CRUD for courses
│       ├── tags.py           # GET /api/tags
│       ├── study_tools.py    # Flashcard + Q&A generation
│       ├── images.py         # POST /api/images/upload
│       ├── corrections.py    # User corrections applied to future extractions
│       ├── preferences.py    # User preferences (heading/bullet style, theme)
│       └── trash.py          # Soft-delete trash + restore
├── frontend/
│   ├── vercel.json           # SPA catch-all rewrite for React Router
│   ├── src/
│   │   ├── App.jsx           # Router, sidebar nav, Clerk provider
│   │   ├── api.js            # Centralised fetch client (attaches Bearer token)
│   │   ├── hooks/
│   │   │   └── useTheme.js   # Per-user theme persistence (scoped to userId)
│   │   └── pages/
│   │       ├── Upload.jsx      # 3-step upload wizard (with duplicate detection)
│   │       ├── BatchUpload.jsx # Multi-file upload with per-file SSE progress
│   │       ├── Library.jsx     # Note grid with search/filter/sort/pagination/batch filter
│   │       ├── NoteEditor.jsx  # Document-style note viewer and editor
│   │       ├── StudyHub.jsx    # Flashcards and practice questions
│   │       └── Preferences.jsx # Theme and display settings (per-user)
│   └── vite.config.js
├── tests/
│   ├── harness.py            # CLI test harness (no server required)
│   ├── test_extraction.py    # Pytest unit tests
│   └── eval_data/
│       ├── transcribe/       # Transcribe-mode eval cases
│       │   ├── positive/     # 10 images/PDFs that should extract cleanly
│       │   └── negative/     # 6 edge cases (blank, outdoor, degraded)
│       └── study_guide/      # Study guide-mode eval cases
│           ├── positive/     # 5 files (subset of transcribe positives)
│           └── negative/     # 6 files (same edge cases)
├── eval/
│   ├── run_eval.py                   # Full eval suite with summary report
│   ├── eval_config_transcribe.json
│   ├── eval_config_study_guide.json
│   ├── last_run_transcribe.json      # Latest transcribe results snapshot
│   └── last_run_study_guide.json     # Latest study guide results snapshot
└── transcripts/                      # AI assistant chat logs from development
```

## Testing

The test harness runs the extraction pipeline in isolation — no web server or database needed.

```bash
cd backend && source .venv/bin/activate && cd ..

# Single image (prints full extraction output)
python tests/harness.py --single path/to/image.jpg --mode transcribe --verbose

# Full eval run — transcribe mode
backend/.venv/bin/python eval/run_eval.py --mode transcribe

# Full eval run — study guide mode
backend/.venv/bin/python eval/run_eval.py --mode study_guide

# Positive set only (faster iteration)
backend/.venv/bin/python eval/run_eval.py --mode transcribe --positive-only

# Unit tests
pytest tests/test_extraction.py -v
```

Eval results are saved to `eval/last_run_transcribe.json` and `eval/last_run_study_guide.json`.

## Evaluation

The eval pipeline tests the AI extraction pipeline independently of the web server across a hand-curated dataset of real student notes.

### Dataset

```
tests/eval_data/
├── transcribe/
│   ├── positive/   10 files — PDFs and images that should extract cleanly
│   └── negative/    6 files — edge cases: blank pages, outdoor photos,
│                              overexposed images, diagrams, rotated images
└── study_guide/
    ├── positive/    5 files — subset reused from transcribe positives
    └── negative/    6 files — same edge cases as transcribe negatives
```

Each file has a paired `.json` ground truth specifying the checks to run:

| Field | Applies to | What it checks |
|-------|------------|----------------|
| `key_terms` + `min_recall` | Positive | Substring recall of expected terms over all extracted text |
| `key_concepts` + `min_recall` | Positive (study guide) | Same, for study guide output |
| `should_have_summary` | Positive (study guide) | At least one section looks like a summary block |
| `should_explain_terms` | Positive (study guide) | Terms appear near explanation phrases (heuristic) |
| `should_warn` | Negative | Model produced at least one extraction warning |
| `should_be_low_confidence` | Negative | Model returned `confidence: "low"` |

Pass criteria: Positive cases require all checks to pass. Negative cases require any check to pass — the model just needs to signal something is wrong.

### Results (transcribe mode, 2026-04-23)

| Set | Passed | Total | Notes |
|-----|--------|-------|-------|
| Positive | 10/10 | 10 | 100% key-term recall |
| Negative | 5/6 | 6 | 83% warning rate; 75% low-confidence rate |
| **Overall** | **15/16** | **16** | **94%** |

The one remaining failure (`rooted_tree_diagram.png`) is an architectural limitation: in the two-step OCR pipeline, the text model only receives extracted text — never the image — so it cannot detect that the source is a pure diagram without any textual explanation. A vision model that sees the image directly would handle this correctly.

### Results (study guide mode, 2026-04-23)

| Set | Passed | Total | Notes |
|-----|--------|-------|-------|
| Positive | 4/5 | 5 | 100% concept recall; 80% summary + explanation |
| Negative | 5/6 | 6 | 83% summary rejection; 50% low-confidence rate |
| **Overall** | **9/11** | **11** | **82%** |

Remaining failures:
- `ml_notes_contrastive_word2vec.pdf` — OCR garbling (missing spaces in the scanned PDF) causes poor text quality into the text model; "contrastive learning" is not explained in the output even though it is detected. Medium confidence is appropriate but heuristic summary check still fails.
- `over_exposed.jpeg` (negative) — same architectural limitation as transcribe: the text model never sees the image, so it cannot detect the exposure problem. The OCR model returns some noise characters which the text model structures into a study guide instead of rejecting.

### What the eval covers

- Key-term and concept recall across 5 PDFs and 5 images spanning handwritten notes, typed slides, cheatsheets, and whiteboard photos
- Rejection behaviour for blank pages, outdoor scenes, overexposed images, diagrams, and rotated images
- Mode-specific quality — transcribe checks faithful reproduction; study guide checks concept coverage, summary structure, and explanation depth
- Total dataset: 27 files evaluated across both modes (16 transcribe + 11 study guide)

## AI Pipeline

Images go through a two-step process:

**Step 1 — OCR (`api-lightonocr-1b`):** Takes the image and returns raw extracted text. This model is free on image input tokens, so it handles the expensive image-to-text conversion cheaply.

**Step 2 — Structuring (`api-gpt-oss-120b`):** Takes the raw text (text-only input) and returns structured JSON — a title, confidence rating, warnings, and typed sections. This same model is also used for flashcard generation, practice questions, and course summaries.

**PDF path:** Text-based PDFs skip OCR entirely. `pypdf` extracts the embedded text, which goes directly to Step 2. Scanned PDFs are not supported — export as PNG/JPEG instead.

**Vision fallback (`api-mistral-small-3.2-2506`):** If the OCR model is unavailable, the pipeline falls back to this vision-capable model which handles both steps in one call.

All prompts live in `prompts.py` with no FastAPI or database imports, so they can be tested and iterated on through the harness independently of the server.

## Limitations

- **Scanned PDFs are not supported** — `pypdf` can only extract text from PDFs with embedded text layers. For scanned or image-only PDFs, export the pages as PNG/JPEG first.
- **Handwritten notes with poor contrast** or very dense writing may produce low-confidence extractions. The app flags these with a confidence indicator and warnings.
- **Local image storage** — manually inserted image sections are saved to `backend/static/images/` on disk and will not persist across server redeployments. The original source file (viewable via the source panel) is stored in browser IndexedDB and is only accessible from the same browser and device it was uploaded on.
