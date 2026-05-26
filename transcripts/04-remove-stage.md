# Chat Transcript — Feedback #1 
**Tool:** Claude (Cowork)

---

**cynthia:** would this actually optimize since the OCR model is cheaper: You could try to combine the 2 stages into one by forcing a specific output from the OCR. This saves on costs since you would only need 1 LLM call. Adding the instructions from the 2nd stage to the 1st stage could be an approach to this optimization.

---

**Claude:** Honestly, no — and the reason is specific to how this pipeline is structured. Let me walk through the numbers and the tradeoffs.

**Why the two-step pipeline is already cheap**

The OCR model (`api-lightonocr-1b`) is free on input — the code even comments this: *"This model is FREE on input — it does not charge for image tokens."* So the only cost at step 1 is the output tokens (the raw text it generates). Step 2 (`api-gpt-oss-120b`) then processes that text — no image tokens, just cheap text-in/text-out. The expensive thing in any vision pipeline is image tokens, and the current design avoids paying for them twice by design.

Merging wouldn't eliminate image token cost — it would just eliminate one API call, saving you a small amount of text token cost on the OCR output being fed back as input.

**The bigger problem: `api-lightonocr-1b` can't do what you'd need it to**

It's a 1-billion parameter model purpose-built for extraction. Your structuring prompt is complex — it asks the model to produce validated JSON with section types, confidence scores, content categorization, suggested titles, user corrections applied, and preference-aware formatting. That's far beyond what a 1B OCR-specialized model can reliably do. You'd get degraded or broken JSON output, which would fall through to the low-confidence fallback handler.

There's also a hard constraint in the code: `api-lightonocr-1b` has an **8192 total context window** (input + output combined). Your system prompt alone — with corrections and preferences — can easily consume 1,000–2,000 tokens before the image is even sent. That leaves very little room for a full structured JSON response.

**Where this optimization actually applies**

The idea is sound for the Anthropic path, where you're paying per image token to a capable vision model. But notice the Anthropic path already *is* single-step — Claude handles OCR and structuring in one call. The TritonAI path was designed two-step specifically because the OCR model is free on input, making it cheaper than sending the image to the expensive text model directly.

**What would actually move the cost needle**

The bigger wins are elsewhere: the structuring prompt passed to `api-gpt-oss-120b` is sent with `max_tokens=8192` even for short documents. Capping that dynamically based on estimated input size would meaningfully reduce completion token costs. Similarly, the flashcard/practice question/course summary calls all use fixed `max_tokens` that could be tightened.