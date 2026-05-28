# Design Decisions

## 1. Cost ceiling implemented as a per-user daily extraction count, not dollar-amount tracking

**The decision:** The assignment required a "cost ceiling" to prevent runaway AI spend on the live deployment. Rather than tracking actual token counts or dollar amounts, the limit is a simple daily extraction count per user — 30 extractions per day, enforced in `backend/routers/extract.py` before the AI pipeline runs. If the count is exceeded, the route returns HTTP 429. The limit is configured via `DAILY_EXTRACTION_LIMIT` in `backend/config.py`.

**Why:** I chose this because it was much simpler and more practical compared to tracking exact cost, which would require counting tokens for each model call, dealing with different prices for different models, and keeping that pricing logic updated over time. A daily extraction count is sufficient, because each extraction is roughly the same cost (one OCR call + one structuring call). It also has a clear, user-understandable meaning, e.g., "you've used your 30 uploads for today", whereas a dollar limit surfaced to users may be confusing. The app does still log model usage and token counts in `backend/routers/costs.py`, so there is visibility into AI usage. 

**Who drove it:** This was mostly my decision. In my proposal, I planned to use a daily upload limit per user as the cost ceiling. The agentic tool helped implement the 429 check in `extract.py` and added the `CostLog` model, but the choice to use a count-based limit instead of exact dollar tracking was mine. 

---

## 2. CORS: stable production URL, with preview URLs handled separately

**The decision:** Using the stable Vercel production URL as the main allowed origin. The URL is set in Railway through `CORS_ORIGINS`, so the actual live frontend is matched directly. 

**Why:** The confusing part was that Vercel's "View" button kept opening a different deployment URL each time. At first, it looked like CORS was breaking because production needed to support all those changing URLs, but eventually I realized those were just unique preview links. The standard production URL users should use was functioning properly. So, the fix was to just use the normal stable Vercel URL to preview each deployment. I still kept a narrow regex for the preview URLs so we could still preview if needed, but the regex is not the main production setup.  

**Who drove it:** This was mostly my decision. The agentic tool initially suggested relying only on regex and setting `CORS_ORIGIN` back to localhost, but that didn't feel right to me for a production deployment. Since the assignment asks for a real live app, I wanted the standard produciton URL to be treated as the main allowed origin. I pushed back on that suggestion, clarified the difference between the stable URL and preview URLs, and the final setup in `backend/main.py` follows that approach. 

---

## 3. Per-user theme stored in localStorage scoped by user ID, not in the database

**The decision:** The user's theme preference is stored in `localStorage` with a user-specific key, like `notesnap_theme_<userId>` (implemented in `frontend/src/hooks/useTheme.js`). It is also mirrored to the backend `UserPreferences` table via `backend/routers/preferences.py`, but the primary source of truth for the current session's theme is the scoped localStorage key.

**Why:** This came out of a bug: theme was stored under a single global key (`notesnap_theme`), so changing the theme on one account changed it for every account on the same browser. Scoping the key to the user ID fixes the isolation bug. The fix was to include the user ID in the localStorage key. That way, each account gets its own saved theme, even if multiple people use the same browser. When the signed-in user changes, the app re-checks localStorage and loads the correct theme for that specific user. The preference is also mirrored to the backend `UserPreferences` table, but localStorage is what makes the current session update immediately.  

**Who drove it:** This was a shared decision. I found and reported the bug while testing multiple user accounts. The agentic tool figured out that the issue was the shared localStorage key and suggested scoping it by user ID. It then updated the relevant frontend files (`useTheme.js`, `App.jsx`, and `Preferences.jsx`). The tool also suggested keeping localStorage as the fast path instead of relying on the database, which I agreed with. 
