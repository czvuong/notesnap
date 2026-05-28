# Transcript: User isolation bug fix (theme preferences)

---

**User:** let's skip vercel for now. are we able to check user isolation without it

**Assistant:** Yes! You can test user isolation entirely locally. Here's the setup:

**The idea:** Run both frontend and backend locally, but pointed at real Clerk auth + Railway PostgreSQL. Two browser profiles = two users.

**What you need:**

1. **Backend `.env`** (at `backend/.env`) with real values:
   ```
   CLERK_SECRET_KEY=sk_test_YOUR_KEY
   DATABASE_URL=postgresql://...  (Railway internal or public URL)
   DAILY_EXTRACTION_LIMIT=30
   CORS_ORIGINS=http://localhost:5173
   ```

2. **Frontend `.env`** (at `frontend/.env`) — you said this still needs to be created:
   ```
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_YOUR_KEY
   VITE_API_BASE=http://localhost:8000
   ```

3. **Run backend:** `.venv/bin/uvicorn main:app --reload` (from `backend/`)

4. **Run frontend:** `npm run dev` (from `frontend/`)

5. **Two-account test:**
   - Browser window 1 (normal) → sign in as User A → create some notes
   - Browser window 2 (incognito) → sign in as User B → verify notes list is empty

Do you have your Clerk keys handy, and is the Railway PostgreSQL already provisioned? If so, we can make sure the env files are set up correctly and verify Phase 5's auth wiring looks right before you run it.

---

**User:** trash and notes are correctly isolated, but user preferences are not. if i change preferences from one account, it changes it on the other account (e.g. color of the pages). do you have access to Desktop/ucsd/Spring '26/CSE 291P/04-student-choice-czvuong-assignment-4? if so, you can make edits to the code directly, but do NOT run any commands in terminal. also tell me what commits and pushes to make to github when appropriate

**Assistant:** Yes, I have access. Let me read the preferences router and model to diagnose the issue.

[Read `backend/routers/preferences.py` and `backend/models.py`]

Found the bug. Let me also check `App.jsx` to see where `useTheme` is called globally.

[Read `frontend/src/App.jsx`]

Got it. Let me also check the theme hook and preferences page.

[Read `frontend/src/hooks/useTheme.js` and `frontend/src/pages/Preferences.jsx`]

Got it. The bug is clear:

**Root cause:** `useTheme` stores the theme under the fixed key `'notesnap_theme'` in `localStorage`. Since localStorage is scoped to the browser origin (not to the user), all accounts on the same machine shared it.

**Fix:** The storage key is now `notesnap_theme_${userId}` (e.g. `notesnap_theme_user_2abc123`). When a different Clerk account signs in, `userId` changes → the `useEffect` fires → reads that user's own key → applies the correct theme.

**Files changed:**
- `frontend/src/hooks/useTheme.js` — `useTheme(userId)` param, scoped key, effect re-runs on user change
- `frontend/src/App.jsx` — calls `useTheme(user?.id ?? null)` (already had `useUser` imported)
- `frontend/src/pages/Preferences.jsx` — adds `useUser` import, passes `user?.id` to `useTheme`

