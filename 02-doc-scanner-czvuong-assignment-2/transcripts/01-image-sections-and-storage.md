# Chat Transcript — Image Section Feature & Production Storage
**Tool:** Claude (Cowork)
**Topic:** Handling noisy PDF extraction, adding image attachment feature, discussing production image storage

---

**cynthia:** *(uploads lect7-perceptron.pdf)*

i showed you the pdf i uploaded and what the notes app extracted. it makes sense why the format is messy (a lot of it is either image or my own handwriting), is there a way to make the format nicer though? like even if it can't perfectly extract it is there a way to either attach a screenshot image (while editing) or to not include nonsense characters like in the first section (0 21 43 5 ...).

also, i don't want to see the md "**" before and after each header. it should just be a header without the symbols

---

**Claude:** *(reads extraction.py, prompts.py, NoteEditor.jsx)*

All three changes are done. Here's a summary:

**`**heading**` markers** — Two-pronged fix:
- Backend (`prompts.py`): the JSON schema now explicitly says headings must be plain text with no `**` markers, and the "bold" preference instruction no longer tells the model to use `**`.
- Frontend (`NoteEditor.jsx`): `stripMdBold()` strips any stray `**...**` from heading display, and `renderRichText()` now converts `**bold**` inside text/bullet content into proper `<strong>` tags rather than showing the asterisks.

**Noisy PDF content** (`extraction.py`): After pypdf extracts text, lines that consist only of digits, spaces, and dots (slide counters, page numbers like "0 21 43 5", TOC indices) are now filtered out before the text is sent to the AI.

**Image section type** — New feature you can use right now:
- Backend: new `POST /api/images/upload` endpoint saves images to `backend/static/` and returns a URL. Run `pip install aiofiles` in your venv.
- Frontend: "Image" is now an option in the section type dropdown. When selected, the edit view shows a file picker instead of a textarea. Clicking save stores the URL; the view renders the actual image.

To use it: open any note → Add section → change type to "Image" → click "Choose image" → pick a screenshot → Save.

---

**cynthia:** is it bad to have something like this in production since we need to store the image ? isn't it bad to store images

---

**Claude:** For a course project running locally, it's completely fine — the images live in `backend/static/images/` on your own machine. No real concern there.

For an actual production app though, yes, filesystem storage has real problems:

**The issues with server filesystem:**
- If the server restarts or redeploys, images are wiped (ephemeral containers like on Heroku/Railway do this)
- Doesn't scale — if you have multiple server instances, they each have their own disk and can't see each other's images
- Disk space on a server is limited and expensive

**What production apps actually do:**
- Upload images to **cloud object storage** (AWS S3, Google Cloud Storage, Cloudflare R2) which is cheap (~$0.02/GB/month), durable, and scales infinitely
- Store just the URL in the database
- Optionally put a CDN in front for fast delivery

**The simplest production-ready upgrade** would be to swap the upload endpoint to use S3 instead of local disk — the frontend and database side wouldn't change at all since they already just store and use a URL.

For now the local filesystem approach is a clean enough abstraction that the upgrade would be minimal — you'd just replace the file-write logic in `routers/images.py` with a `boto3` S3 upload call. The rest of the system is already designed correctly (section content stores a URL, not raw bytes).

So: bad for real production, totally acceptable for a course project, and the architecture is set up so it's easy to swap later.
