"""
eval/run_eval.py — Automated evaluation script.

Runs the full eval dataset and produces a summary report.
This is a thin wrapper around tests/harness.py that enforces
the standard eval config and formats results as a report.

Usage:
    # Full evaluation using config file
    python eval/run_eval.py

    # Override mode
    python eval/run_eval.py --mode study_guide

    # Only run positive set
    python eval/run_eval.py --positive-only

    # Only run negative set
    python eval/run_eval.py --negative-only
"""

import json
import sys
from pathlib import Path
from datetime import datetime

import click

# Allow imports from tests/ and backend/
repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root / "backend"))
sys.path.insert(0, str(repo_root / "tests"))

from harness import run_single


@click.command()
@click.option("--mode", type=click.Choice(["transcribe", "study_guide"]), default="transcribe")
@click.option("--positive-only", is_flag=True, default=False)
@click.option("--negative-only", is_flag=True, default=False)
@click.option("--verbose", is_flag=True, default=False)
def main(mode, positive_only, negative_only, verbose):
    """Run the full NoteSnap evaluation suite."""

    config_path = repo_root / "eval" / "eval_config.json"
    with open(config_path) as f:
        config = json.load(f)

    positive_dir = repo_root / "tests" / "eval_data" / "positive"
    negative_dir = repo_root / "tests" / "eval_data" / "negative"

    supported = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"}

    positive_images = sorted(p for p in positive_dir.iterdir() if p.suffix.lower() in supported) \
        if positive_dir.exists() else []
    negative_images = sorted(p for p in negative_dir.iterdir() if p.suffix.lower() in supported) \
        if negative_dir.exists() else []

    if positive_only:
        negative_images = []
    if negative_only:
        positive_images = []

    min_recall = config.get("min_recall_threshold", 0.7)

    click.echo(f"\n{'='*60}")
    click.echo(f"NoteSnap Evaluation — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    click.echo(f"Mode: {mode} | Min recall threshold: {min_recall:.0%}")
    click.echo(f"{'='*60}\n")

    all_results = []

    # ── Positive set ──────────────────────────────────────────────────────────
    if positive_images:
        click.echo(f"POSITIVE SET ({len(positive_images)} images — should extract cleanly)\n")
        pos_results = []
        for img in positive_images:
            click.echo(f"  {img.name}...", nl=False)
            r = run_single(img, mode=mode, verbose=verbose)
            pos_results.append(r)
            _print_result_line(r)

        _print_section_summary("Positive", pos_results, min_recall)
        all_results.extend(pos_results)

    # ── Negative set ──────────────────────────────────────────────────────────
    if negative_images:
        click.echo(f"\nNEGATIVE SET ({len(negative_images)} images — edge cases / degraded quality)\n")
        neg_results = []
        for img in negative_images:
            click.echo(f"  {img.name}...", nl=False)
            r = run_single(img, mode=mode, verbose=verbose)
            neg_results.append(r)
            # For negative images, "pass" means the model correctly flagged
            # low confidence or returned a warning — we want graceful degradation
            graceful = r.get("confidence") in ("low", "medium") or bool(r.get("warnings"))
            r["graceful_degradation"] = graceful
            _print_result_line(r, show_graceful=True)

        _print_section_summary("Negative (graceful degradation)", neg_results, min_recall, negative=True)
        all_results.extend(neg_results)

    # ── Overall summary ───────────────────────────────────────────────────────
    if positive_images and negative_images:
        click.echo(f"\n{'='*60}")
        click.echo("OVERALL SUMMARY")
        total  = len(all_results)
        errors = sum(1 for r in all_results if r["status"] == "ERROR")
        click.echo(f"  Total images tested: {total}")
        click.echo(f"  Errors:              {errors}")
        gt_results = [r for r in all_results if r.get("eval")]
        if gt_results:
            avg = sum(r["eval"]["key_term_recall"] for r in gt_results) / len(gt_results)
            click.echo(f"  Avg key-term recall: {avg:.1%} ({len(gt_results)} images with ground truth)")

    # Write results to file
    output_path = repo_root / config.get("output_file", "eval/last_run_results.json")
    output_path.parent.mkdir(exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    click.echo(f"\nFull results saved to {output_path.relative_to(repo_root)}\n")


def _print_result_line(r: dict, show_graceful: bool = False):
    elapsed = r.get("elapsed", "?")
    conf    = r.get("confidence", "n/a")
    if r["status"] == "ERROR":
        click.echo(f" {click.style('ERROR', fg='red')}  — {r.get('detail', '')}")
        return

    if show_graceful:
        ok = r.get("graceful_degradation", False)
        label = click.style("GRACEFUL", fg="green") if ok else click.style("UNEXPECTED HIGH CONF", fg="yellow")
    else:
        ok = r.get("pass", False)
        label = click.style("PASS", fg="green") if ok else click.style("FAIL", fg="red")

    recall_str = ""
    if r.get("eval"):
        recall = r["eval"]["key_term_recall"]
        recall_str = f"  recall={recall:.0%}"

    click.echo(f" {label}  ({elapsed}) [conf: {conf}]{recall_str}")


def _print_section_summary(label: str, results: list, min_recall: float, negative: bool = False):
    total  = len(results)
    errors = sum(1 for r in results if r["status"] == "ERROR")
    if negative:
        passed = sum(1 for r in results if r.get("graceful_degradation"))
    else:
        passed = sum(1 for r in results if r.get("pass"))

    click.echo(f"\n  {label} summary: {passed}/{total} passed, {errors} errors")
    gt = [r for r in results if r.get("eval")]
    if gt:
        avg = sum(r["eval"]["key_term_recall"] for r in gt) / len(gt)
        below = [r for r in gt if r["eval"]["key_term_recall"] < min_recall]
        click.echo(f"  Avg recall: {avg:.1%} | Below threshold: {len(below)}")
        if below:
            click.echo(f"  Low recall files: {[r['file'] for r in below]}")


if __name__ == "__main__":
    main()
