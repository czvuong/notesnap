"""
eval/run_eval.py — Automated evaluation script.

Runs the full eval dataset for a given mode and produces a summary report.
Transcribe and study_guide are evaluated separately because they have
different goals and use different ground truth fields.

Directory layout expected:
    tests/eval_data/
        transcribe/
            positive/   ← images + .json ground truths (key_terms, expected_section_count)
            negative/   ← images + optional .json (should_warn, should_be_low_confidence, …)
        study_guide/
            positive/   ← images + .json ground truths (key_concepts, should_have_summary, …)
            negative/   ← images + optional .json (should_warn, should_not_have_summary, …)

Usage:
    python eval/run_eval.py --mode transcribe
    python eval/run_eval.py --mode study_guide
    python eval/run_eval.py --mode transcribe --positive-only
    python eval/run_eval.py --mode transcribe --negative-only
    python eval/run_eval.py --mode transcribe --verbose
"""

import json
import sys
from pathlib import Path
from datetime import datetime

import click

repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root / "backend"))
sys.path.insert(0, str(repo_root / "tests"))

from harness import run_single


SUPPORTED = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".pdf"}


@click.command()
@click.option(
    "--mode",
    type=click.Choice(["transcribe", "study_guide"]),
    required=True,
    help="Which extraction mode to evaluate. Must be specified explicitly.",
)
@click.option("--positive-only", is_flag=True, default=False,
              help="Run only the positive set.")
@click.option("--negative-only", is_flag=True, default=False,
              help="Run only the negative set.")
@click.option("--verbose", is_flag=True, default=False,
              help="Print full extraction output and per-check breakdown.")
def main(mode, positive_only, negative_only, verbose):
    """
    Run the NoteSnap evaluation suite for a specific extraction mode.

    Transcription and study guide are evaluated separately because they have
    different goals:
      - transcribe:   prioritises faithful extraction (key-term recall, section fidelity)
      - study_guide:  prioritises concept coverage, summary structure, and lightweight
                      explanation checks (heuristic, not full semantic quality)
    """
    config_path = repo_root / "eval" / f"eval_config_{mode}.json"
    if not config_path.exists():
        click.echo(f"Error: config file not found: {config_path}", err=True)
        sys.exit(1)

    with open(config_path) as f:
        config = json.load(f)

    min_recall   = config.get("min_recall_threshold", 0.7)
    output_path  = repo_root / config.get("output_file", f"eval/last_run_{mode}.json")

    data_root    = repo_root / "tests" / "eval_data" / mode
    positive_dir = data_root / "positive"
    negative_dir = data_root / "negative"

    positive_images = _collect(positive_dir)
    negative_images = _collect(negative_dir)

    if positive_only:
        negative_images = []
    if negative_only:
        positive_images = []

    click.echo(f"\n{'='*60}")
    click.echo(f"NoteSnap Evaluation — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    click.echo(f"Mode: {mode} | Min recall threshold: {min_recall:.0%}")
    click.echo(f"Positive: {len(positive_images)} image(s) | "
               f"Negative: {len(negative_images)} image(s)")
    click.echo(f"{'='*60}\n")

    all_results = []

    # ── Positive set ──────────────────────────────────────────────────────────
    if positive_images:
        click.echo(f"POSITIVE SET ({len(positive_images)} images — should extract cleanly)\n")
        pos_results = []
        for img in positive_images:
            click.echo(f"  {img.name}...", nl=False)
            r = run_single(img, mode=mode, is_negative=False, verbose=verbose)
            pos_results.append(r)
            _print_line(r)
        _print_summary("Positive", pos_results, min_recall, negative=False)
        all_results.extend(pos_results)

    # ── Negative set ──────────────────────────────────────────────────────────
    if negative_images:
        click.echo(f"\nNEGATIVE SET ({len(negative_images)} images — edge cases / degraded)\n")
        neg_results = []
        for img in negative_images:
            click.echo(f"  {img.name}...", nl=False)
            r = run_single(img, mode=mode, is_negative=True, verbose=verbose)
            neg_results.append(r)
            _print_line(r)
        _print_summary("Negative", neg_results, min_recall, negative=True)
        all_results.extend(neg_results)

    # ── Overall ───────────────────────────────────────────────────────────────
    if positive_images and negative_images:
        click.echo(f"\n{'='*60}")
        click.echo("OVERALL SUMMARY")
        total  = len(all_results)
        passed = sum(1 for r in all_results if r.get("pass"))
        errors = sum(1 for r in all_results if r["status"] == "ERROR")
        click.echo(f"  Total:  {total}  |  Passed: {passed}  |  Errors: {errors}")

        gt = [r for r in all_results if r.get("eval") and r["eval"]]
        if gt:
            all_checks: dict[str, list[bool]] = {}
            for r in gt:
                for check, ok in r["eval"].get("checks", {}).items():
                    all_checks.setdefault(check, []).append(ok)
            click.echo("\n  Per-check pass rate (images with ground truth):")
            for check, outcomes in all_checks.items():
                rate = sum(outcomes) / len(outcomes)
                click.echo(f"    {check}: {rate:.0%} ({sum(outcomes)}/{len(outcomes)})")

    # ── Save results ──────────────────────────────────────────────────────────
    output_path.parent.mkdir(exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    click.echo(f"\nFull results saved to {output_path.relative_to(repo_root)}\n")


def _collect(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    return sorted(p for p in directory.iterdir() if p.suffix.lower() in SUPPORTED)


def _print_line(r: dict):
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
    if r.get("eval") and r["eval"] and r["eval"].get("checks"):
        failed = [k for k, v in r["eval"]["checks"].items() if not v]
        if failed:
            checks_str = f"  failed: {', '.join(failed)}"

    click.echo(f" {label}  ({elapsed}){checks_str}")


def _print_summary(label: str, results: list, min_recall: float, negative: bool):
    total  = len(results)
    passed = sum(1 for r in results if r.get("pass"))
    errors = sum(1 for r in results if r["status"] == "ERROR")
    color  = "green" if passed == total - errors else "yellow"

    click.echo(
        f"\n  {label} summary: "
        + click.style(f"{passed}/{total} passed", fg=color)
        + f", {errors} errors"
    )

    gt = [r for r in results if r.get("eval") and r["eval"]]
    if gt:
        all_checks: dict[str, list[bool]] = {}
        for r in gt:
            for check, ok in r["eval"].get("checks", {}).items():
                all_checks.setdefault(check, []).append(ok)
        for check, outcomes in all_checks.items():
            rate  = sum(outcomes) / len(outcomes)
            color = "green" if rate == 1.0 else ("yellow" if rate >= min_recall else "red")
            click.echo(
                f"    {check}: "
                + click.style(f"{rate:.0%}", fg=color)
                + f" ({sum(outcomes)}/{len(outcomes)})"
            )


if __name__ == "__main__":
    main()
