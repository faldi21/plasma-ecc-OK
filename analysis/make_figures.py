#!/usr/bin/env python3
"""
analysis/make_figures.py (docs/TICKETS.md T8).

Reads ONLY data/processed/<RUN_ID>/*.csv (and stats.json, unused today but
kept as an accepted input for parity with make_tables.py, in case a future
figure needs a CI computed there rather than in aggregate.py) -- no new
measurement or statistical computation, only plotting pre-aggregated
values. Writes exactly:

  fig_gas_vs_n.pdf   L2 commit gas vs n for sys.plasma_v0 ("as submitted")
                     and sys.plasma_eccmath ("memory-optimized"), with
                     their difference on a secondary axis
  fig_throughput.pdf ops/s vs T for the 5 E3 cells, 95% CI error bars

A point with no ok data (all \\fillin{}-worthy in the table sense) is
simply omitted from the plotted line rather than plotted as zero -- never
fabricated (CLAUDE.md IRON RULE 1). A cell_id with status
exceeds_block_gas_limit is annotated on the plot, not silently dropped
(CLAUDE.md IRON RULE 7).

Idempotent by construction: matplotlib's PDF backend embeds a
CreationDate/ModDate by default, which would make two runs differ even
with identical data -- both are explicitly suppressed via `metadata=`.

Usage:
  python3 analysis/make_figures.py --run-id <RUN_ID> --data data --out <dir>
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

# No creation/modification timestamp in the PDF -- otherwise byte-identical
# re-runs would still differ file-to-file (docs/TICKETS.md T8's idempotency
# rule).
PDF_METADATA = {"CreationDate": None, "ModDate": None}

E3_CELLS = [
    ("ASC inline", "asc.inline"),
    ("ASC deferred", "asc.deferred"),
    ("Merkle inline", "merkle.inline"),
    ("Merkle deferred", "merkle.deferred"),
    ("Keccak deferred", "keccak.deferred"),
]
T_VALUES = [500, 1000, 1500, 2000]
SYS_N_VALUES = [10, 25, 50, 100, 200]


def load_csv(path: Path) -> dict[str, dict[str, str]]:
    if not path.is_file():
        return {}
    with open(path, "r", encoding="utf-8", newline="") as f:
        return {row["cell_id"]: row for row in csv.DictReader(f) if row.get("cell_id")}


def num(cells: dict[str, dict[str, str]], cell_id: str, column: str) -> float | None:
    row = cells.get(cell_id)
    if row is None:
        return None
    val = row.get(column)
    if val is None or val == "":
        return None
    try:
        return float(val)
    except ValueError:
        return None


def build_fig_gas_vs_n(e1: dict[str, dict[str, str]], out_path: Path) -> None:
    ns, v0_means, v0_errs, ecc_means, ecc_errs, diffs, diff_ns = [], [], [], [], [], [], []
    exceeded: list[tuple[int, str]] = []

    for n in SYS_N_VALUES:
        v0_id = f"sys.plasma_v0.n{n}"
        ecc_id = f"sys.plasma_eccmath.n{n}"
        for cell_id, label in [(v0_id, "as-submitted"), (ecc_id, "memory-optimized")]:
            row = e1.get(cell_id)
            if row and row.get("primary_status") == "exceeds_block_gas_limit":
                exceeded.append((n, label))

        v0_mean = num(e1, v0_id, "gas_used_mean")
        ecc_mean = num(e1, ecc_id, "gas_used_mean")
        if v0_mean is not None:
            ns.append(n)
            v0_means.append(v0_mean)
            v0_errs.append((num(e1, v0_id, "gas_used_ci95_high") or v0_mean) - v0_mean)
        if ecc_mean is not None:
            ecc_means.append(ecc_mean)
            ecc_errs.append((num(e1, ecc_id, "gas_used_ci95_high") or ecc_mean) - ecc_mean)
        if v0_mean is not None and ecc_mean is not None:
            diff_ns.append(n)
            diffs.append(v0_mean - ecc_mean)

    fig, ax1 = plt.subplots(figsize=(6, 4))
    if ns and len(v0_means) == len(ns):
        ax1.errorbar(ns, v0_means, yerr=v0_errs, marker="o", label="As submitted (sys.plasma_v0)", color="#1f77b4")
    if ns and len(ecc_means) == len(ns):
        ax1.errorbar(ns[: len(ecc_means)], ecc_means, yerr=ecc_errs, marker="s", label="Memory-optimized (sys.plasma_eccmath)", color="#2ca02c")
    ax1.set_xlabel("$n$ (elements committed per block)")
    ax1.set_ylabel("L2 construction gas (createBlock)")
    ax1.ticklabel_format(axis="y", style="plain")

    if diff_ns:
        ax2 = ax1.twinx()
        ax2.plot(diff_ns, diffs, marker="^", linestyle="--", color="#d62728", label="Difference (as-submitted $-$ memory-optimized)")
        ax2.set_ylabel("Difference (gas)", color="#d62728")
        ax2.tick_params(axis="y", labelcolor="#d62728")

    for n, label in exceeded:
        ax1.annotate(f"{label}\nn={n}: exceeds block gas limit", xy=(n, ax1.get_ylim()[1]), xytext=(0, 5), textcoords="offset points", fontsize=7, ha="center", color="#d62728")

    lines1, labels1 = ax1.get_legend_handles_labels()
    if diff_ns:
        lines2, labels2 = ax2.get_legend_handles_labels()
        ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper left", fontsize=8)
    else:
        ax1.legend(loc="upper left", fontsize=8)

    fig.tight_layout()
    fig.savefig(out_path, metadata=PDF_METADATA)
    plt.close(fig)


def build_fig_throughput(e3: dict[str, dict[str, str]], out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(6, 4))
    exceeded: list[tuple[str, int]] = []

    for label, cell_key in E3_CELLS:
        ts, means, err_low, err_high = [], [], [], []
        for t in T_VALUES:
            cell_id = f"e3.{cell_key}.T{t}"
            row = e3.get(cell_id)
            if row and row.get("primary_status") == "exceeds_block_gas_limit":
                exceeded.append((label, t))
                continue
            mean = num(e3, cell_id, "ops_per_sec_mean")
            if mean is None:
                continue
            ci_lo = num(e3, cell_id, "ops_per_sec_ci95_low")
            ci_hi = num(e3, cell_id, "ops_per_sec_ci95_high")
            ts.append(t)
            means.append(mean)
            err_low.append(mean - ci_lo if ci_lo is not None else 0.0)
            err_high.append(ci_hi - mean if ci_hi is not None else 0.0)
        if ts:
            ax.errorbar(ts, means, yerr=[err_low, err_high], marker="o", capsize=3, label=label)

    if exceeded:
        note = "; ".join(f"{label} T={t}: exceeds block gas limit" for label, t in exceeded)
        ax.annotate(note, xy=(0.5, -0.22), xycoords="axes fraction", ha="center", fontsize=7, color="#d62728")

    ax.set_xlabel("$T$ (total hot-path operations)")
    ax.set_ylabel("ops/s (hot-path UTXO operations)")
    ax.legend(loc="best", fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, metadata=PDF_METADATA)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--data", default="data")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    data_root = Path(args.data)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    processed_dir = data_root / "processed" / args.run_id

    e1 = load_csv(processed_dir / "e1_commit_cost.csv")
    e3 = load_csv(processed_dir / "e3_throughput.csv")

    gas_vs_n_path = out_dir / "fig_gas_vs_n.pdf"
    build_fig_gas_vs_n(e1, gas_vs_n_path)
    print(f"[make_figures] wrote {gas_vs_n_path}")

    throughput_path = out_dir / "fig_throughput.pdf"
    build_fig_throughput(e3, throughput_path)
    print(f"[make_figures] wrote {throughput_path}")


if __name__ == "__main__":
    main()
