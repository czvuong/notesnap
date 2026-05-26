"""
cost_tracking.py — Lightweight per-call LLM cost logging.

Call log_cost() immediately after every API response.  It opens its own
short-lived database session so that extraction.py stays database-free.
Errors are swallowed — cost logging must never crash an actual request.

Rate table
----------
Rates are in USD per 1 000 000 tokens (matching OpenAI's published format).
TritonAI models are internal and have no public pricing; their rate entries
are left as None so the DB row stores NULL for estimated_cost_usd.  Token
counts are always recorded regardless of whether cost can be estimated.

Update the table below whenever pricing changes.
"""

import logging

logger = logging.getLogger(__name__)


# (input_per_1M_USD, output_per_1M_USD)  —  None = unknown / free / internal
_RATES: dict[str, tuple[float, float] | None] = {
    # ── TritonAI internal models ──────────────────────────────────────────────
    # Rates not publicly published.  Tokens are tracked; cost is left as NULL.
    "api-lightonocr-1b":             None,
    "api-gpt-oss-120b":              None,
    "api-mistral-small-3.2-2506":    None,

    # ── Anthropic (https://www.anthropic.com/pricing) ─────────────────────────
    "claude-3-5-sonnet-20241022":    (3.00,  15.00),
    "claude-3-5-haiku-20241022":     (0.80,   4.00),
    "claude-3-opus-20240229":        (15.00,  75.00),
    "claude-opus-4-6":               (15.00,  75.00),
    "claude-sonnet-4-6":             (3.00,  15.00),
    "claude-haiku-4-5-20251001":     (0.80,   4.00),
}


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    """Return an estimated USD cost, or None if the model rate is unknown."""
    rates = _RATES.get(model)
    if rates is None:
        return None
    input_rate, output_rate = rates
    return (prompt_tokens * input_rate + completion_tokens * output_rate) / 1_000_000


def log_cost(
    model: str,
    operation: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> None:
    """
    Persist one cost-log row.

    Args:
        model:             The model name as it appears in the API response
                           (e.g. "api-gpt-oss-120b", "claude-3-5-sonnet-20241022").
        operation:         Human-readable label for what this call was doing,
                           e.g. "ocr", "structure", "flashcards", "course_summary".
        prompt_tokens:     Input/prompt token count from response.usage.
        completion_tokens: Output/completion token count from response.usage.
    """
    try:
        from database import SessionLocal
        from models import CostLog

        estimated = _estimate_cost(model, prompt_tokens, completion_tokens)
        row = CostLog(
            model=model,
            operation=operation,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            estimated_cost_usd=estimated,
        )
        db = SessionLocal()
        try:
            db.add(row)
            db.commit()
        finally:
            db.close()

        logger.debug(
            "Cost logged: model=%s op=%s in=%d out=%d est_usd=%s",
            model,
            operation,
            prompt_tokens,
            completion_tokens,
            f"${estimated:.6f}" if estimated is not None else "unknown",
        )
    except Exception:
        logger.exception("Cost logging failed — ignoring so the request is not affected")
