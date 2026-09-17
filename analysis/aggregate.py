#!/usr/bin/env python3
"""
analysis/aggregate.py (docs/TICKETS.md T8; docs/EXPERIMENT_PRD.md §7.1).

data/raw/<RUN_ID>/*.jsonl -> data/processed/<RUN_ID>/*.csv, one CSV per
input JSONL file (same basename), grouped by cell_id. Per group: mean, SD,
median, p95, min, max, N, CI95% (t-Student) for every numeric metric that
experiment's records carry, PLUS n_total/n_ok/n_failed/n_retried and a
status_breakdown string.

Hard requirement (CLAUDE.md IRON RULE 2 and 7, restated explicitly for
this ticket): non-"ok"/"pass" statuses (exceeds_block_gas_limit, error,
error(batch_timeout), fail) are counted and reported, never silently
dropped. A cell whose every run is non-ok still gets a row -- n_ok=0, all
descriptive-stat columns empty (not zero, not omitted), status_breakdown
and primary_status naming exactly what happened. make_tables.py is
responsible for turning that into "melebihi batas blok" + a footnote, not
this script (this script only aggregates; it does not decide prose).

Deterministic and idempotent by construction: no wall-clock timestamps are
written, cell ordering and CSV column ordering are both sorted, and the
only computation is arithmetic over the input file's own values -- running
this twice on the same RUN_ID produces byte-identical CSVs.

Usage:
  python3 analysis/aggregate.py --run-id <RUN_ID> [--run-id-e3 <RUN_ID_E3>] --data data

Dua RUN_ID (ANALYSIS_PLAN.md Amandemen 2): E1/E2/E4 dan E3 dibekukan
terpisah, masing-masing menunjuk commit-nya sendiri. --run-id-e3 (atau
RUN_ID_E3) menunjuk dataset E3; kalau tidak diberikan, nilainya sama
dengan --run-id, sehingga pemakaian satu-RUN_ID lama tetap jalan persis
seperti sebelumnya. Kedua dataset TIDAK PERNAH digabung ke satu
direktori -- yang dibagi hanyalah rujukan, bukan datanya.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (
    OK_STATUSES,
    cell_venue,
    describe,
    find_run_jsonl_files,
    read_jsonl,
    status_breakdown,
)

ALPHA = 0.05

# Every numeric field a bench.* / sys.* / e2 record might carry. Absent or
# null for a given record is simply skipped -- this list is a superset
# across e1_commit_cost.jsonl and e2_sync_gas.jsonl on purpose, so one
# function handles both without per-file special-casing.
SCALAR_METRIC_FIELDS = [
    "gas_used",
    "gas_limit",
    "calldata_bytes",
    "calldata_zero_bytes",
    "calldata_nonzero_bytes",
    "tx_count",
    "duration_ms",
]

BASE_COLUMNS = [
    "cell_id",
    "layer",
    # Where the measurement actually ran, derived by common.venue_of()
    # (ANALYSIS_PLAN.md Amandemen 4). Distinct from `layer`: a layer="L1"
    # cell can still have venue="local" when the operation needs a cheat
    # code no public network offers. Derived here so that make_tables.py
    # can LABEL the distinction without hardcoding which cells are which.
    "venue",
    "function",
    "n_elements",
    "n_total",
    "n_ok",
    "n_failed",
    "n_retried",
    "primary_status",
    "status_breakdown",
]


def group_by_cell(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    by_cell: dict[str, list[dict[str, Any]]] = {}
    for r in records:
        by_cell.setdefault(r["cell_id"], []).append(r)
    return by_cell


def primary_status(records: list[dict[str, Any]], ok_count: int) -> str:
    """The word this cell's status is reported as. Uses the record's OWN
    status string (e.g. "pass" for E4 Foundry tests, "ok" for E1/E2/E3
    receipts) rather than a hardcoded "ok" literal -- an earlier version
    of this function always wrote "ok" even for E4 rows, silently
    replacing "pass" with a word that isn't what actually got recorded
    (caught by inspecting tab_exploits.tex's actual output, which showed
    every test as "ok" instead of "pass")."""
    if ok_count > 0:
        ok_statuses = {r.get("status") for r in records if r.get("status") in OK_STATUSES}
        label = next(iter(ok_statuses)) if len(ok_statuses) == 1 else "/".join(sorted(ok_statuses))
        return label if ok_count == len(records) else f"partial_{label}"
    statuses = {r.get("status") for r in records}
    if len(statuses) == 1:
        return next(iter(statuses))
    return "mixed_failure"


def base_row(cell_id: str, records: list[dict[str, Any]], ok_records: list[dict[str, Any]]) -> dict[str, Any]:
    first = records[0]
    return {
        "cell_id": cell_id,
        "layer": first.get("layer"),
        "venue": cell_venue(records),
        "function": first.get("function"),
        "n_elements": first.get("n_elements"),
        "n_total": len(records),
        "n_ok": len(ok_records),
        "n_failed": len(records) - len(ok_records),
        "n_retried": sum(r.get("ops_retried") or 0 for r in records),
        "primary_status": primary_status(records, len(ok_records)),
        "status_breakdown": status_breakdown(records),
    }


def aggregate_scalar_file(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """e1_commit_cost.jsonl / e2_sync_gas.jsonl shape: one scalar
    measurement per record (gas_used, and for E1's L1-anchor cells also
    calldata_*/tx_count)."""
    rows = []
    for cell_id, recs in sorted(group_by_cell(records).items()):
        ok_recs = [r for r in recs if r.get("status") in OK_STATUSES]
        row = base_row(cell_id, recs, ok_recs)
        for field_name in SCALAR_METRIC_FIELDS:
            vals = [r[field_name] for r in ok_recs if r.get(field_name) is not None]
            row.update(describe(vals, ALPHA).as_row(field_name))
        rows.append(row)
    return rows


def e3_by_repetition_rows(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per raw E3 record (cell_id, repetition), with ops_per_sec/
    l2_tx_per_sec derived the same way as aggregate_e3_file(). This is
    the RAW-SAMPLE companion to the per-cell summary CSV: Mann-Whitney U
    and Shapiro-Wilk (docs/EXPERIMENT_PRD.md §7.2/7.3, required by
    analysis/stats.py) need the actual per-repetition values, not a
    mean/SD summary -- Welch's t-test and Cohen's d could technically be
    reconstructed from summary statistics alone, but the non-parametric
    tests cannot, so stats.py reads this file rather than *_throughput.csv.
    Only "ok" records are included: a failed/timed-out repetition has no
    well-defined ops/s to test.
    """
    rows = []
    for r in records:
        if r.get("status") not in OK_STATUSES:
            continue
        dur_s = (r.get("duration_ms") or 0) / 1000.0
        if dur_s <= 0:
            continue
        ops_per_sec = r["ops_completed"] / dur_s if r.get("ops_completed") is not None else None
        l2_tx_per_sec = r["tx_count"] / dur_s if r.get("tx_count") is not None else None
        rows.append(
            {
                "cell_id": r["cell_id"],
                "repetition": r.get("repetition"),
                "seed": r.get("seed"),
                "duration_ms": r.get("duration_ms"),
                "ops_completed": r.get("ops_completed"),
                "ops_per_sec": ops_per_sec,
                "l2_tx_per_sec": l2_tx_per_sec,
            }
        )
    return rows


def aggregate_e3_file(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """e3_throughput.jsonl shape: one record per (cell, repetition), each
    covering several batches. ops/s and L2 tx/s (CLAUDE.md's own
    definitions -- ops/s = successful logical transfers / wall-clock;
    L2 tx/s = txs sent / the same wall-clock) are derived PER REPETITION
    from that repetition's own ops_completed/tx_count/duration_ms, then
    described across repetitions; latency_ms is a per-batch array and is
    flattened across every batch in every ok repetition before describing,
    so median/p95 latency reflect individual batches, not repetition
    means (per-batch is what docs/EXPERIMENT_PRD.md §6.3 asks for)."""
    rows = []
    for cell_id, recs in sorted(group_by_cell(records).items()):
        ok_recs = [r for r in recs if r.get("status") in OK_STATUSES]
        row = base_row(cell_id, recs, ok_recs)

        ops_per_sec = []
        l2_tx_per_sec = []
        for r in ok_recs:
            dur_s = (r.get("duration_ms") or 0) / 1000.0
            if dur_s <= 0:
                continue
            if r.get("ops_completed") is not None:
                ops_per_sec.append(r["ops_completed"] / dur_s)
            if r.get("tx_count") is not None:
                l2_tx_per_sec.append(r["tx_count"] / dur_s)
        row.update(describe(ops_per_sec, ALPHA).as_row("ops_per_sec"))
        row.update(describe(l2_tx_per_sec, ALPHA).as_row("l2_tx_per_sec"))

        all_latencies: list[float] = []
        for r in ok_recs:
            if r.get("latency_ms"):
                all_latencies.extend(r["latency_ms"])
        row.update(describe(all_latencies, ALPHA).as_row("latency_ms"))

        rows.append(row)
    return rows


def aggregate_e4_file(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """e4_exploits.jsonl shape: one Foundry test per cell_id, status is
    pass/fail (not ok/error). `notes` carries the specific numbers the
    paper quotes (e.g. "ExploitA1 challengeExitWithSpendProof gas:
    944466") -- preserved verbatim (deduplicated, sorted) rather than
    reduced to only descriptive stats, since make_tables.py's
    tab_exploits.tex needs to quote exact values from notes (T8's own
    instruction), not just gas_used's mean."""
    rows = []
    for cell_id, recs in sorted(group_by_cell(records).items()):
        ok_recs = [r for r in recs if r.get("status") in OK_STATUSES]
        row = base_row(cell_id, recs, ok_recs)
        row["test_name"] = recs[0].get("test_name")
        parts = cell_id.split(".", 2)
        row["contract"] = parts[1] if len(parts) > 1 else None
        notes = sorted({r["notes"] for r in recs if r.get("notes")})
        row["notes"] = " | ".join(notes)
        gas_vals = [r["gas_used"] for r in ok_recs if r.get("gas_used") is not None]
        row.update(describe(gas_vals, ALPHA).as_row("gas_used"))
        rows.append(row)
    return rows


def pick_aggregator(filename: str):
    if filename == "e3_throughput.jsonl":
        return aggregate_e3_file
    if filename == "e4_exploits.jsonl":
        return aggregate_e4_file
    return aggregate_scalar_file


def write_csv(rows: list[dict[str, Any]], out_path: Path) -> None:
    if not rows:
        out_path.write_text("", encoding="utf-8")
        return
    all_keys: set[str] = set()
    for row in rows:
        all_keys.update(row.keys())
    extra = sorted(k for k in all_keys if k not in BASE_COLUMNS)
    fieldnames = [c for c in BASE_COLUMNS if c in all_keys] + extra

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def aggregate_one_run(data_root: Path, run_id: str) -> None:
    """Aggregates one RUN_ID's raw JSONL into its OWN processed directory."""
    jsonl_files = find_run_jsonl_files(data_root, run_id)
    if not jsonl_files:
        print(f"[aggregate] no *.jsonl files found under {data_root}/raw/{run_id}", file=sys.stderr)
        sys.exit(1)

    out_dir = data_root / "processed" / run_id
    for jsonl_path in jsonl_files:
        records = read_jsonl(jsonl_path)
        aggregator = pick_aggregator(jsonl_path.name)
        rows = aggregator(records)
        out_path = out_dir / (jsonl_path.stem + ".csv")
        write_csv(rows, out_path)
        n_failed_cells = sum(1 for r in rows if r["n_ok"] == 0)
        print(f"[aggregate] {jsonl_path.name}: {len(rows)} cells ({n_failed_cells} entirely non-ok) -> {out_path}")

        if jsonl_path.name == "e3_throughput.jsonl":
            by_rep_rows = e3_by_repetition_rows(records)
            by_rep_path = out_dir / "e3_throughput_by_rep.csv"
            write_csv(by_rep_rows, by_rep_path)
            print(f"[aggregate] {jsonl_path.name}: {len(by_rep_rows)} raw ok repetitions -> {by_rep_path} (for stats.py)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-id", required=True)
    ap.add_argument(
        "--run-id-e3",
        default=None,
        help="RUN_ID of the separately frozen E3 dataset (ANALYSIS_PLAN.md Amandemen 2). "
        "Aggregated into its own processed/<RUN_ID_E3>/ directory, never merged with --run-id's. "
        "Defaults to --run-id.",
    )
    ap.add_argument("--data", default="data")
    args = ap.parse_args()

    data_root = Path(args.data)
    aggregate_one_run(data_root, args.run_id)
    if args.run_id_e3 and args.run_id_e3 != args.run_id:
        print(f"[aggregate] E3 dataset is separate: {args.run_id_e3}")
        aggregate_one_run(data_root, args.run_id_e3)


if __name__ == "__main__":
    main()
