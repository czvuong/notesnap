# Feedback Response

This file documents my responses to each piece of feedback I received during the in-class review session.

---

## Issue #1 by Nathan

**Feedback #1:**

You could try to combine the 2 stages into one by forcing a specific output from the OCR. This saves on costs since you would only need 1 LLM call. Adding the instructions from the 2nd stage to the 1st stage could be an approach to this optimization.

**Response #1:**

The current two-stage pipeline has been designed with cost efficiency in mind. The OCR step uses `api-lightonocr-1b`, which has no input cost and only charges for output tokens. The second stage uses `api-gpt-oss-120b`, which operates purely on text, avoiding more expensive image tokens and keeping overall costs low. 

While combining both stages into a single call could reduce the number of API requests, the OCR model alone is not sufficiently powerful enough to produce the structured outputs required (e.g. section types, categorization, titles, and formatting). So, this would likely degrade output quality.

That said, this design is specific to TritonAI. I also implemented a fallback path using Anthropic models, where a single model (Claude) can handle both OCR and structuring effectively in one call. In that setting, I agree with this feedback of only having a single stage, but this has already been implemented. 

---

**Feedback #2:**

Convert already transcribed notes/study guides to flash cards. Take the json of the already transcribed notes and send it through the flashcard pipeline.

**Response #2:**

This functionality is already supported in the current system. Users are able to generate flashcards or practice questions directly from their uploaded notes. 

---

## Issue #2 by Phuoc

**Feedback #1:**

The app currently makes two API calls every time a document is uploaded — one to extract the text, and one to structure it. These run one after the other, so users wait for both calls to complete.
A simple improvement would be to cache the first call's result. Since the same image always produces the same raw text, there's no need to re-run the first API call if the user uploads the same image twice. Hashing the image and storing the result in a dictionary would skip one full API round trip on repeat uploads, cutting latency roughly in half for those cases. This change would only touch one file and wouldn't affect anything else in the app.

**Response #1:**

I have implemented this optimization. The system now caches the OCR output by hashing the uploaded image. If the same image is uploaded again, the OCR step is skipped and the cached text is reused, eliminating one API call and reducing latency for repeat uploads.

Additionally, the UI now detects duplicate uploads and displays a message to the user, allowing them to either cancel the upload or proceed. This ensures users are aware of duplicates while still giving them control over whether to continue.

Relevant commit [here](https://github.com/ucsd-cse-genai-programming-sp26/02-doc-scanner-czvuong-assignment-2/commit/efc77f7e002943445fe1b14de02bae4791aafd88). 