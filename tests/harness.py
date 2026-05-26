"""
tests/harness.py — CLI test harness for the extraction pipeline.

Runs extraction on one image or a whole folder, compares results against
ground truth if available, and prints a per-check summary.

This file has NO dependency on FastAPI or the database — it imports
extraction.py directly so the pipeline is testable in isolation.

Ground truth files live next to the image with the same stem:
    tests/eval_data/transcribe/positive/math_notes.jpg
    tests/eval_data/transcribe/positive/math_notes.json

Usage examples:
    # Single image (transcribe mode, verbose)
    python harness.py --single tests/eval_data/transcribe/positive/math_notes.jpg --verbose

    # Full transcribe positive set
    python harness.py --dir tests/eval_data/transcribe/positive --mode transcribe

    # Both sets for study_guide
    python harness.py --dir tests/eval_data/study_guide/positive \\
                      --dir tests/eval_data/study_guide/negative \\
                      --mode study_guide

    # Via config file
    python harness.py --config eval/eval_config_transcribe.json
"""

import json
import re
import sys
import time
from pathlib import Path

import click

# Allow importing from backend/ without installing the package
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from extraction import extract_note


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".pdf"}

# Words that suggest a term is being explained rather than just mentioned.
# Covers both formal definition language ("is defined as") and natural prose
# ("convolution involves sliding a filter…", "pooling reduces spatial size…").
_EXPLANATION_WORDS = [
    "means", "refers to", "is defined as", "describes", "represents",
    "stands for", "is used to", "in other words", "defined as", "meaning",
    "which is", "that is",
    # natural study-guide prose
    "is a", "are", "is the", "involves", "works by", "allows", "enables",
    "performs", "applies", "captures", "computes", "reduces", "extracts",
    "is when", "used for", "helps", "typically",
]
# Section headings a study guide commonly uses — formal ("Summary") and
# informal ("Key Concepts", "Introduction", "Conclusion", "TL;DR", …).
_SUMMARY_WORDS = [
    "summary", "overview", "main idea", "key points", "key takeaways", "recap",
    "introduction", "conclusion", "tldr", "tl;dr", "in summary", "to summarize",
    "key concepts", "concepts covered", "what you need to know",
    # titles like "Notes on X", "Guide to Y", "Review of Z" are also summaries
    "notes on", "guide to", "review of", "study guide",
]

# Window (chars) around a term to search for explanation language.
# 300 chars gives enough room for the term to appear in a clause with prose
# explanation without requiring formal "X means Y" phrasing.
_EXPLAIN_WINDOW = 300


# ── Ground truth loading ──────────────────────────────────────────────────────

def load_ground_truth(image_path: Path) -> dict | None:
    """
    Look for a ground truth JSON file alongside the image.
    e.g. math_notes.jpg → math_notes.json
    Returns None if no ground truth file exists.
    """
    gt_path = image_path.with_suffix(".json")
    if gt_path.exists():
        with open(gt_path) as f:
            return json.load(f)
    return None


# ── Evaluation helpers ────────────────────────────────────────────────────────

def _all_text(result) -> str:
    """Concatenate all section content + title into one lowercase string."""
    parts = [result.suggested_title]
    parts += [s.heading or "" for s in result.sections]
    parts += [s.content for s in result.sections]
    return " ".join(parts).lower()


def _has_summary_section(result) -> bool:
    """True if the title, any section heading, or section content looks like a summary.

    Study guides often encode the summary in the title itself (e.g. 'Key Concepts
    in CNN Architecture', 'Overview of Classifier Learning Methods') rather than
    in a dedicated 'Summary' section, so we check the title first.
    """
    # Check the suggested title
    title = (result.suggested_title or "").lower()
    if any(w in title for w in _SUMMARY_WORDS):
        return True
    # Check section headings
    for section in result.sections:
        heading = (section.heading or "").lower()
        if any(w in heading for w in _SUMMARY_WORDS):
            return True
    # Also check a short prefix of each section's content
    for section in result.sections:
        snippet = section.content[:120].lower()
        if any(w in snippet for w in _SUMMARY_WORDS):
            return True
    return False


def _term_is_explained(term: str, all_text: str) -> bool:
    """
    Heuristic: the term is 'explained' if it appears within _EXPLAIN_WINDOW
    characters of an explanation word/phrase.
    """
    term_lower = term.lower()
    for match in re.finditer(re.escape(term_lower), all_text):
        start = max(0, match.start() - _EXPLAIN_WINDOW)
        end   = min(len(all_text), match.end() + _EXPLAIN_WINDOW)
        window = all_text[start:end]
        if any(ew in window for ew in _EXPLANATION_WORDS):
            return True
    return False


def _evaluate_transcribe(result, ground_truth: dict, is_negative: bool) -> dict:
    """
    Evaluate a transcription result.

    Positive checks:
      - key_terms:             substring recall over all extracted text (primary)
      - expected_section_count: reported as info only — section granularity is
                                model-dependent and less important than content recall

    Negative checks (is_negative=True):
      - should_warn:              expects result.warnings to be non-empty
      - should_be_low_confidence: expects confidence == "low"
      - max_key_terms:            extracted text should contain FEWER than this many terms
      Negatives pass if ANY check passes — the model just needs to signal something is wrong.
    """
    text = _all_text(result)
    checks: dict[str, bool] = {}
    detail: dict[str, object] = {}

    if is_negative:
        if "should_warn" in ground_truth:
            checks["should_warn"] = bool(result.warnings)
            detail["warnings"] = result.warnings

        if "should_be_low_confidence" in ground_truth:
            checks["should_be_low_confidence"] = result.confidence == "low"
            detail["confidence"] = result.confidence

        if "max_key_terms" in ground_truth and "key_terms" in ground_truth:
            terms = [t.lower() for t in ground_truth["key_terms"]]
            found = [t for t in terms if t in text]
            checks["max_key_terms"] = len(found) <= ground_truth["max_key_terms"]
            detail["found_term_count"] = len(found)
            detail["max_allowed"]      = ground_truth["max_key_terms"]

        # expected_section_count is informational only for negatives too
        if "expected_section_count" in ground_truth:
            detail["actual_sections"]   = len(result.sections)
            detail["expected_sections"] = ground_truth["expected_section_count"]

        # Negatives pass if ANY signal fires — model just needs to flag the problem
        passed = any(checks.values()) if checks else False

    else:
        if "key_terms" in ground_truth:
            expected = [t.lower() for t in ground_truth["key_terms"]]
            found    = [t for t in expected if t in text]
            missing  = [t for t in expected if t not in text]
            recall   = len(found) / len(expected) if expected else 1.0
            min_r    = ground_truth.get("min_recall", 0.7)
            checks["key_term_recall"] = recall >= min_r
            detail["key_term_recall"] = recall
            detail["found_terms"]     = found
            detail["missing_terms"]   = missing
            detail["min_recall"]      = min_r

        # expected_section_count is informational only — section granularity varies
        # too much between model runs to be a reliable pass/fail criterion.
        if "expected_section_count" in ground_truth:
            detail["actual_sections"]   = len(result.sections)
            detail["expected_sections"] = ground_truth["expected_section_count"]

        passed = all(checks.values()) if checks else (result.confidence != "low")

    return {"checks": checks, "detail": detail, "passed": passed}


def _evaluate_study_guide(result, ground_truth: dict, is_negative: bool) -> dict:
    """
    Evaluate a study guide result.

    Positive checks:
      - key_concepts:        substring recall over the study guide text
      - should_have_summary: passes if any section looks like a summary block
      - should_explain_terms: heuristic window check — term + explanation word
                              must co-occur within _EXPLAIN_WINDOW characters

    Negative checks:
      - should_warn:                 expects result.warnings to be non-empty
      - should_be_low_confidence:    expects confidence == "low"
      - should_not_have_summary:     the output should NOT look like a polished guide
    """
    text = _all_text(result)
    checks: dict[str, bool] = {}
    detail: dict[str, object] = {}

    if is_negative:
        if "should_warn" in ground_truth:
            checks["should_warn"] = bool(result.warnings)
            detail["warnings"] = result.warnings

        if "should_be_low_confidence" in ground_truth:
            checks["should_be_low_confidence"] = result.confidence == "low"
            detail["confidence"] = result.confidence

        if "should_not_have_summary" in ground_truth:
            has_summary = _has_summary_section(result)
            checks["should_not_have_summary"] = not has_summary
            detail["has_summary"] = has_summary

        # Negatives pass if ANY signal fires — model just needs to flag the problem
        passed = any(checks.values()) if checks else False

    else:
        if "key_concepts" in ground_truth:
            expected = [c.lower() for c in ground_truth["key_concepts"]]
            found    = [c for c in expected if c in text]
            missing  = [c for c in expected if c not in text]
            recall   = len(found) / len(expected) if expected else 1.0
            min_r    = ground_truth.get("min_recall", 0.7)
            checks["key_concept_recall"] = recall >= min_r
            detail["key_concept_recall"] = recall
            detail["found_concepts"]     = found
            detail["missing_concepts"]   = missing
            detail["min_recall"]         = min_r

        if ground_truth.get("should_have_summary"):
            has_summary = _has_summary_section(result)
            checks["should_have_summary"] = has_summary
            detail["has_summary"] = has_summary

        if "should_explain_terms" in ground_truth:
            terms          = ground_truth["should_explain_terms"]
            explained      = [t for t in terms if _term_is_explained(t, text)]
            not_explained  = [t for t in terms if not _term_is_explained(t, text)]
            checks["should_explain_terms"] = len(explained) == len(terms)
            detail["explained_terms"]      = explained
            detail["unexplained_terms"]    = not_explained
            detail["explain_note"] = (
                f"Heuristic: term must appear within {_EXPLAIN_WINDOW} chars "
                "of an explanation phrase (e.g. 'means', 'refers to', 'is defined as')."
            )

        passed = all(checks.values()) if checks else (result.confidence != "low")

    return {"checks": checks, "detail": detail, "passed": passed}


def evaluate_result(result, ground_truth: dict, mode: str, is_negative: bool) -> dict:
    """
    Dispatch to the correct mode-specific evaluator.
    Also asserts that the ground truth JSON 'mode' field matches the CLI mode.
    """
    gt_mode = ground_truth.get("mode")
    if gt_mode and gt_mode != mode:
        return {
            "checks":  {},
            "detail":  {"mode_mismatch": f"Ground truth says '{gt_mode}', CLI mode is '{mode}'"},
            "passed":  False,
            "error":   f"MODE MISMATCH: ground truth mode='{gt_mode}' but running mode='{mode}'",
        }

    if mode == "transcribe":
        return _evaluate_transcribe(result, ground_truth, is_negative)
    elif mode == "study_guide":
        return _evaluate_study_guide(result, ground_truth, is_negative)
    else:
        return {"checks": {}, "detail": {}, "passed": False,
                "error": f"Unknown mode '{mode}'"}


# ── Core runner ───────────────────────────────────────────────────────────────

def run_single(
    image_path: Path,
    mode: str,
    is_negative: bool = False,
    verbose: bool = False,
) -> dict:
    """
    Run extraction on one image and return a result summary dict.
    """
    if not image_path.exists():
        return {"file": str(image_path), "status": "ERROR", "detail": "File not found"}

    image_bytes = image_path.read_bytes()
    start = time.time()

    try:
        result = extract_note(image_bytes=image_bytes, mode=mode)
        elapsed = time.time() - start
    except Exception as e:
        elapsed = time.time() - start
        return {
            "file":    image_path.name,
            "status":  "ERROR",
            "detail":  str(e),
            "elapsed": f"{elapsed:.1f}s",
        }

    summary = {
        "file":       image_path.name,
        "status":     "OK",
        "mode":       mode,
        "set":        "negative" if is_negative else "positive",
        "title":      result.suggested_title,
        "sections":   len(result.sections),
        "confidence": result.confidence,
        "warnings":   result.warnings,
        "elapsed":    f"{elapsed:.1f}s",
    }

    ground_truth = load_ground_truth(image_path)
    if ground_truth:
        eval_out = evaluate_result(result, ground_truth, mode, is_negative)
        summary["eval"]  = eval_out
        summary["pass"]  = eval_out["passed"]
        if "error" in eval_out:
            summary["eval_error"] = eval_out["error"]
    else:
        # No ground truth: basic pass heuristic
        summary["pass"] = result.confidence != "low" if not is_negative else (
            result.confidence in ("low", "medium") or bool(result.warnings)
        )
        summary["eval"] = None

    if verbose:
        _print_verbose(image_path, result, summary)

    return summary


def _print_verbose(image_path: Path, result, summary: dict):
    click.echo(f"\n{'='*60}")
    click.echo(f"File:       {image_path.name}")
    click.echo(f"Mode:       {summary['mode']}  |  Set: {summary['set']}")
    click.echo(f"Title:      {result.suggested_title}")
    click.echo(f"Confidence: {result.confidence}")
    for i, s in enumerate(result.sections):
        click.echo(f"\n  Section {i+1}: {s.heading or '(no heading)'} [{s.content_type}]")
        click.echo(f"  {s.content[:200]}{'...' if len(s.content) > 200 else ''}")
    if result.warnings:
        click.echo(f"\n  Warnings: {result.warnings}")
    if summary.get("eval"):
        ev = summary["eval"]
        click.echo(f"\n  Checks:")
        for check, ok in ev.get("checks", {}).items():
            icon = click.style("✓", fg="green") if ok else click.style("✗", fg="red")
            click.echo(f"    {icon} {check}")
        if ev.get("detail"):
            for k, v in ev["detail"].items():
                if k != "explain_note":
                    click.echo(f"    {k}: {v}")


# ── CLI ───────────────────────────────────────────────────────────────────────

@click.command()
@click.option("--single", "single_file", type=click.Path(), default=None,
              help="Path to a single image file to test.")
@click.option("--dir", "directories", type=click.Path(), multiple=True,
              help="Directory of images to test (repeatable). Mark negatives with --negative-dir.")
@click.option("--negative-dir", "negative_dirs", type=click.Path(), multiple=True,
              help="Directory of negative-set images (different pass criteria).")
@click.option("--mode", type=click.Choice(["transcribe", "study_guide"]), default="transcribe",
              show_default=True, help="Extraction mode.")
@click.option("--config", "config_file", type=click.Path(), default=None,
              help="JSON config file (see eval/eval_config_transcribe.json for format).")
@click.option("--verbose", is_flag=True, default=False,
              help="Print full extraction output and per-check breakdown for each image.")
@click.option("--output", type=click.Path(), default=None,
              help="Write full results JSON to this path.")
def main(single_file, directories, negative_dirs, mode, config_file, verbose, output):
    """
    NoteSnap extraction test harness.
    Tests the AI extraction pipeline independently of the web server.
    """
    if config_file:
        with open(config_file) as f:
            cfg = json.load(f)
        mode        = cfg.get("mode", mode)
        directories = list(directories) + cfg.get("directories", [])
        negative_dirs = list(negative_dirs) + cfg.get("negative_directories", [])
        if cfg.get("single_file"):
            single_file = cfg["single_file"]

    pos_images: list[Path] = []
    neg_images: list[Path] = []

    if single_file:
        pos_images.append(Path(single_file))

    for d in directories:
        dp = Path(d)
        if not dp.is_dir():
            click.echo(f"Warning: {d} is not a directory, skipping.", err=True)
            continue
        pos_images.extend(
            p for p in sorted(dp.iterdir()) if p.suffix.lower() in SUPPORTED_EXTENSIONS
        )

    for d in negative_dirs:
        dp = Path(d)
        if not dp.is_dir():
            click.echo(f"Warning: {d} is not a directory, skipping.", err=True)
            continue
        neg_images.extend(
            p for p in sorted(dp.iterdir()) if p.suffix.lower() in SUPPORTED_EXTENSIONS
        )

    all_images = pos_images + neg_images
    if not all_images:
        click.echo("No images found. Use --single, --dir, --negative-dir, or --config.", err=True)
        sys.exit(1)

    click.echo(f"\nRunning extraction — mode: '{mode}' | "
               f"{len(pos_images)} positive, {len(neg_images)} negative\n")

    results = []

    for img_path in pos_images:
        click.echo(f"  [positive] {img_path.name}...", nl=False)
        r = run_single(img_path, mode=mode, is_negative=False, verbose=verbose)
        results.append(r)
        _print_result_line(r)

    for img_path in neg_images:
        click.echo(f"  [negative] {img_path.name}...", nl=False)
        r = run_single(img_path, mode=mode, is_negative=True, verbose=verbose)
        results.append(r)
        _print_result_line(r)

    # ── Summary ───────────────────────────────────────────────────────────────
    total  = len(results)
    passed = sum(1 for r in results if r.get("pass"))
    errors = sum(1 for r in results if r["status"] == "ERROR")
    failed = total - passed - errors

    click.echo(f"\n{'─'*50}")
    click.echo(
        f"Results: {total} total  |  "
        + click.style(f"{passed} passed", fg="green") + "  |  "
        + click.style(f"{failed} failed", fg="yellow" if failed else "white") + "  |  "
        + click.style(f"{errors} errors", fg="red" if errors else "white")
    )

    gt_results = [r for r in results if r.get("eval") and r["eval"]]
    if gt_results:
        # Report per-check pass rates across the run
        all_checks: dict[str, list[bool]] = {}
        for r in gt_results:
            for check, ok in r["eval"].get("checks", {}).items():
                all_checks.setdefault(check, []).append(ok)
        click.echo("\n  Per-check pass rate:")
        for check, outcomes in all_checks.items():
            rate = sum(outcomes) / len(outcomes)
            click.echo(f"    {check}: {rate:.0%} ({sum(outcomes)}/{len(outcomes)})")

    if output:
        with open(output, "w") as f:
            json.dump(results, f, indent=2, default=str)
        click.echo(f"\nFull results written to {output}")

    click.echo()
    sys.exit(0 if failed == 0 and errors == 0 else 1)


def _print_result_line(r: dict):
    elapsed = r.get("elapsed", "?")
    conf    = r.get("confidence", "n/a")

    if r["status"] == "ERROR":
        click.echo(f" {click.style('ERROR', fg='red')}  — {r.get('detail', '')}")
        return

    if r.get("eval_error"):
        click.echo(f" {click.style('CONFIG ERR', fg='yellow')}  — {r['eval_error']}")
        return

    ok    = r.get("pass", False)
    label = click.style("PASS", fg="green") if ok else click.style("FAIL", fg="red")

    checks_str = ""
    if r.get("eval") and r["eval"].get("checks"):
        checks = r["eval"]["checks"]
        failed = [k for k, v in checks.items() if not v]
        if failed:
            checks_str = f"  failed: {', '.join(failed)}"

    click.echo(f" {label}  ({elapsed}) [conf: {conf}]{checks_str}")


if __name__ == "__main__":
    main()
