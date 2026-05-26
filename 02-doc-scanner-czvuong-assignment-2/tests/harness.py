"""
tests/harness.py — CLI test harness for the extraction pipeline.

Runs extraction on one image or a whole folder, compares results against
ground truth if available, and prints a summary table.

This file has NO dependency on FastAPI or the database — it imports
extraction.py directly so the pipeline is testable in isolation.

Usage examples:
    # Run a single image in transcribe mode
    python harness.py --single tests/eval_data/positive/math_equations.jpg

    # Run all images in a folder
    python harness.py --dir tests/eval_data/positive --mode transcribe

    # Run with a config file (for automated evaluation)
    python harness.py --config eval/eval_config.json

    # Run both positive and negative sets and show summary
    python harness.py --dir tests/eval_data/positive --dir tests/eval_data/negative
"""

import json
import os
import sys
import time
from pathlib import Path

import click

# Allow importing from backend/ without installing the package
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from extraction import extract_note


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"}


# ── Evaluation helpers ────────────────────────────────────────────────────────

def load_ground_truth(image_path: Path) -> dict | None:
    """
    Look for a ground truth JSON file alongside the image.
    e.g. math_equations.jpg → math_equations.json
    Returns None if no ground truth exists for this image.
    """
    gt_path = image_path.with_suffix(".json")
    if gt_path.exists():
        with open(gt_path) as f:
            return json.load(f)
    return None


def evaluate_result(result, ground_truth: dict) -> dict:
    """
    Compare extraction result against ground truth.

    Metrics:
      - key_term_recall: % of expected key terms found in any section content
      - schema_valid:    all required fields present and non-empty
      - confidence:      what the AI reported
      - section_count_match: whether section count matches expectation (if provided)
    """
    all_content = " ".join(s.content.lower() for s in result.sections)
    all_content += " " + result.suggested_title.lower()

    expected_terms = [t.lower() for t in ground_truth.get("key_terms", [])]
    found_terms = [t for t in expected_terms if t in all_content]
    recall = len(found_terms) / len(expected_terms) if expected_terms else 1.0

    schema_valid = (
        bool(result.suggested_title)
        and len(result.sections) > 0
        and all(s.content for s in result.sections)
    )

    expected_sections = ground_truth.get("expected_section_count")
    section_match = (
        len(result.sections) == expected_sections
        if expected_sections is not None else None
    )

    return {
        "key_term_recall":      recall,
        "found_terms":          found_terms,
        "missing_terms":        [t for t in expected_terms if t not in all_content],
        "schema_valid":         schema_valid,
        "confidence":           result.confidence,
        "section_count":        len(result.sections),
        "section_count_match":  section_match,
        "warnings":             result.warnings,
    }


def run_single(image_path: Path, mode: str, verbose: bool = False) -> dict:
    """
    Run extraction on one image. Returns a result summary dict.
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
        "file":           image_path.name,
        "status":         "OK",
        "mode":           mode,
        "title":          result.suggested_title,
        "sections":       len(result.sections),
        "confidence":     result.confidence,
        "warnings":       result.warnings,
        "elapsed":        f"{elapsed:.1f}s",
    }

    ground_truth = load_ground_truth(image_path)
    if ground_truth:
        eval_metrics = evaluate_result(result, ground_truth)
        summary["eval"] = eval_metrics
        summary["pass"] = (
            eval_metrics["schema_valid"]
            and eval_metrics["key_term_recall"] >= ground_truth.get("min_recall", 0.7)
        )
    else:
        summary["pass"] = summary["confidence"] != "low"  # basic pass if no ground truth

    if verbose:
        click.echo(f"\n{'='*60}")
        click.echo(f"File: {image_path.name}")
        click.echo(f"Title: {result.suggested_title}")
        click.echo(f"Confidence: {result.confidence}")
        for i, s in enumerate(result.sections):
            click.echo(f"\n  Section {i+1}: {s.heading or '(no heading)'} [{s.content_type}]")
            click.echo(f"  {s.content[:200]}{'...' if len(s.content) > 200 else ''}")
        if result.warnings:
            click.echo(f"\n  Warnings: {result.warnings}")

    return summary


# ── CLI ───────────────────────────────────────────────────────────────────────

@click.command()
@click.option("--single", "single_file", type=click.Path(), default=None,
              help="Path to a single image file to test.")
@click.option("--dir", "directories", type=click.Path(), multiple=True,
              help="Directory of images to test. Can be repeated.")
@click.option("--mode", type=click.Choice(["transcribe", "study_guide"]), default="transcribe",
              help="Extraction mode to use.")
@click.option("--config", "config_file", type=click.Path(), default=None,
              help="JSON config file (see eval/eval_config.json for format).")
@click.option("--verbose", is_flag=True, default=False,
              help="Print full extraction output for each image.")
@click.option("--output", type=click.Path(), default=None,
              help="Write full results JSON to this file.")
def main(single_file, directories, mode, config_file, verbose, output):
    """
    NoteSnap extraction test harness.
    Tests the AI extraction pipeline independently of the web server.
    """
    # Load config file if provided — it can override mode and set directories
    if config_file:
        with open(config_file) as f:
            cfg = json.load(f)
        mode = cfg.get("mode", mode)
        if cfg.get("directories"):
            directories = list(directories) + cfg["directories"]
        if cfg.get("single_file"):
            single_file = cfg["single_file"]

    images: list[Path] = []

    if single_file:
        images.append(Path(single_file))

    for d in directories:
        dp = Path(d)
        if not dp.is_dir():
            click.echo(f"Warning: {d} is not a directory, skipping.", err=True)
            continue
        images.extend(
            p for p in sorted(dp.iterdir())
            if p.suffix.lower() in SUPPORTED_EXTENSIONS
        )

    if not images:
        click.echo("No images found. Use --single, --dir, or --config.", err=True)
        sys.exit(1)

    click.echo(f"\nRunning extraction on {len(images)} image(s) in '{mode}' mode...\n")

    results = []
    for img_path in images:
        click.echo(f"  Testing {img_path.name}...", nl=False)
        r = run_single(img_path, mode=mode, verbose=verbose)
        results.append(r)
        status_str = click.style("PASS", fg="green") if r.get("pass") else click.style("FAIL", fg="red")
        if r["status"] == "ERROR":
            status_str = click.style("ERROR", fg="red")
        click.echo(f" {status_str}  ({r.get('elapsed', '?')}) "
                   f"[conf: {r.get('confidence', 'n/a')}]")

    # ── Summary ───────────────────────────────────────────────────────────────
    total   = len(results)
    passed  = sum(1 for r in results if r.get("pass"))
    errors  = sum(1 for r in results if r["status"] == "ERROR")
    failed  = total - passed - errors

    click.echo(f"\n{'─'*50}")
    click.echo(f"Results: {total} total  |  "
               + click.style(f"{passed} passed", fg="green") + "  |  "
               + click.style(f"{failed} failed", fg="yellow" if failed else "white") + "  |  "
               + click.style(f"{errors} errors", fg="red" if errors else "white"))

    # Recall stats (only for images with ground truth)
    gt_results = [r for r in results if r.get("eval")]
    if gt_results:
        avg_recall = sum(r["eval"]["key_term_recall"] for r in gt_results) / len(gt_results)
        click.echo(f"Avg key-term recall (ground truth): {avg_recall:.1%} over {len(gt_results)} image(s)")

    if output:
        with open(output, "w") as f:
            json.dump(results, f, indent=2, default=str)
        click.echo(f"\nFull results written to {output}")

    click.echo()
    sys.exit(0 if failed == 0 and errors == 0 else 1)


if __name__ == "__main__":
    main()
