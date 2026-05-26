# Chat Transcript — Duplicate Document Detection
**Tool:** Claude (Cowork)

---
**cynthia:** this sounds like a good suggestion to implement. is this feasible? will it require image storage? 


```markdown
The app currently makes two API calls every time a document is uploaded — one to extract the text, and one to structure it. These run one after the other, so users wait for both calls to complete.
A simple improvement would be to cache the first call's result. Since the same image always produces the same raw text, there's no need to re-run the first API call if the user uploads the same image twice. Hashing the image and storing the result in a dictionary would skip one full API round trip on repeat uploads, cutting latency roughly in half for those cases. This change would only touch one file and wouldn't affect anything else in the app.
```

---

**Claude:** Feasible, and no image storage needed at all — just the hash (a short string) and the raw text output. Here's an honest breakdown:

**What gets cached and what doesn't**

The OCR step (`api-lightonocr-1b`) is purely deterministic — the same image always produces the same raw text. So you hash the image bytes in memory, store `{hash → raw_text}`, and skip the OCR call on a repeat. Step 2 (structuring) still runs fresh every time, which is correct since it depends on mode, corrections, and user preferences.

**No image storage required.** You never save the image bytes anywhere — you just compute a SHA-256 hash before the call and throw the bytes away as usual. The only thing stored is the OCR text output, which is just a plain string.

**Implementation is genuinely one file, ~10 lines.** In `extraction.py`, before the `_call_ocr_model` call:

```python
import hashlib

_ocr_cache: dict[str, str] = {}  # image_hash → raw OCR text

# inside extract_note(), before _call_ocr_model:
image_hash = hashlib.sha256(image_bytes).hexdigest()
if image_hash in _ocr_cache:
    raw_text = _ocr_cache[image_hash]
    ocr_used = True
else:
    raw_text = _call_ocr_model(b64_image, mime_type)
    _ocr_cache[image_hash] = raw_text
    ocr_used = True
```

**The honest caveats**

The in-memory dict is the right starting point, but it has no size limit — if someone uploads thousands of unique images the server will slowly accumulate text in memory. That's easy to fix with `functools.lru_cache` or capping the dict at say 200 entries.

More importantly: **the real-world hit rate is probably low.** Students uploading the exact same image twice is a fairly rare case. Your batch upload page already deduplicates files by name + size before they're sent, so even batch users won't trigger it often. The suggestion is sound and cheap to implement, but don't expect it to meaningfully change average latency — it's more of a correctness/efficiency nicety than a meaningful optimization.

If you want to implement it, it's a clean low-risk change. Want me to add it?

---

**cynthia:** yes let's add it with a size limit

---

**Claude:** Two small edits — add the cache at the top of the file, then use it at the OCR call site:Now wire it in at the OCR call site:Done. Here's what was added:

- **`_ocr_cache`** — an `OrderedDict` capped at 200 entries. `OrderedDict` is used instead of a plain dict because it lets us track insertion order, so when the cache is full we can drop the oldest entry in O(1) rather than scanning the whole dict.

- **Cache key** — SHA-256 of the raw image bytes. Fast to compute, collision-resistant, and no image ever needs to be stored.

- **On hit** — logs the cache hit with the first 12 chars of the hash for easy debugging, skips the API call entirely, goes straight to the structuring step.

- **On miss** — calls OCR as before, then stores the result. If the cache is already at 200 entries, the oldest one is evicted first.

- **Fallback untouched** — if the OCR model is unavailable (403/404), the vision fallback path is unchanged and nothing gets cached, which is correct since that path didn't use the OCR model.

---

**cynthia:** can we also add a message if a user uploads the same image twice, something like "document already in library. proceed?"

---

**Claude:** Good, I have everything I need. Now making all the changes:Now attach the hash to the ExtractionResult in `extraction.py`:Also update `_ocr_cache_get` to use the already-computed hash instead of recomputing it:Now save the hash in `_batch_save_note` and add the check endpoint:Now add the check endpoint. Let me see the top of extract.py for imports:Now the frontend — add `checkImageHashes` to `api.js` and wire up the duplicate check in `BatchUpload.jsx`:Now check if `post` is defined in api.js (we need it for `checkImageHashes`):Good. Now update `BatchUpload.jsx` — import the new helpers, add hash state to file items, and run the check after files are added:Add `AlertTriangle` to the icon imports:Now add `isDuplicate` and `duplicateTitle` to the file state, and add the async check after `addFiles`:Now add the duplicate-check helper and call it after `addFiles`. Find the `addFiles` function and the state declarations:Now show the duplicate warning in `FileRow`. Find it:Add the CSS for the duplicate state:Done. One DB migration needed before restarting — from your `02-doc-scanner-czvuong-assignment-2/` directory:

```bash
sqlite3 backend/notesnap.db "ALTER TABLE notes ADD COLUMN image_hash TEXT;"
```

Here's what the full flow looks like now:

1. User drops files into the batch upload page
2. The browser immediately hashes each file using the native `crypto.subtle` API (no upload needed — this runs locally in milliseconds)
3. The hashes are sent to `POST /api/extract/check-hashes`, which looks up which ones match non-deleted notes in the DB
4. Any matched files get a yellow warning row: amber triangle icon, amber border, and the message **"Already in library as 'Kernel Trick and SVM Notes' — will create a duplicate"**
5. The user can remove the file or ignore the warning and proceed anyway — it's non-blocking

The hash is also stored on every newly created note going forward, so the duplicate check will catch files that were uploaded in previous sessions, not just the current one.


