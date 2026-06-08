# Regrets

Things I wish I had done differently, and advice for anyone picking this project up in the future.

---

## 1. Source files are device-local because of IndexedDB

Uploaded images and PDFs are stored in the browser's IndexedDB, not on the server. This means if you upload a note on your phone, you can see the source document there, but switching to your laptop shows the note without the original file. The note content is fully synced (it lives in PostgreSQL), but the source file is not.

This was a deliberate choice to avoid building a file storage system (S3, Cloudflare R2, etc.) for a course project, but it's surprising to users and feels like a bug. If I were starting over, I would either store source files in object storage from day one, or remove the source-preview feature entirely rather than leaving it in a half-working state across devices.

**Advice:** Either commit to cloud file storage early, or don't surface the source preview at all.

---

## 2. Clerk JWTs don't include email by default — this broke collaborative sharing

When a user is invited to a note by email, the backend needs to match their Clerk JWT to the invite record. The obvious way is to read the email from the JWT. But Clerk does not include email in JWTs unless you explicitly configure a JWT template with `"email": "{{user.primary_email_address}}"`. I did not know this when I built the invite system, so email matching silently failed for every new invite.

The fix was to add a fallback: call the Clerk Backend API (`GET /v1/users/{user_id}`) to look up the user's email when the JWT doesn't include it. That works, but it means every first-time collaborator request makes an extra API call, and it adds a dependency on `CLERK_SECRET_KEY` being set correctly in Railway. When I initially set that env var, I accidentally used the publishable key (`pk_...`) instead of the secret key (`sk_...`), which caused silent 401 failures.

**Advice:** Set up a Clerk JWT template that includes email before building anything that depends on user identity beyond the Clerk user ID. It takes two minutes in the Clerk dashboard and prevents a whole class of matching bugs.

---

## 3. No migration tool — inline raw SQL is fragile at scale

Schema changes are handled with raw `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements that run on startup. This works for a small project with one developer, but it has no rollback, no audit trail, and no way to test migrations in isolation. It also creates a mess of conditional SQL scattered across `backend/database.py` and `backend/models.py`.

**Advice:** Set up Alembic from the very beginning. Running `alembic revision --autogenerate` is only slightly more work than writing a raw SQL statement, and it gives you a full migration history, rollbacks, and a clear record of every schema change. The pain of retrofitting it later is much worse than starting with it.

---

## 4. No tests until the end

I wrote tests late in the project, which meant bugs in the auth middleware, collaborator matching, and section permission checks sat undetected until manual testing revealed them. The collaborator section-edit bug (where a "Can edit" collaborator got "Note not found." when saving) would have been caught immediately by a simple integration test.

**Advice:** Write at least a small integration test suite for the auth and permission paths before shipping the multi-user system. These are the paths most likely to fail silently and most painful to debug in production.

---

## 5. The two-stage AI pipeline is TritonAI-specific and not portable

The current pipeline (OCR model → structuring model) only works on the UCSD TritonAI cluster. The Anthropic fallback path works anywhere, but it's treated as a secondary option. Any future engineer inheriting this codebase who doesn't have TritonAI access will find the default configuration non-functional and will need to swap to the Anthropic provider via the `AI_PROVIDER` env var.

**Advice:** Document the `AI_PROVIDER=anthropic` fallback prominently in the README. Consider making it the default outside of the UCSD environment.

