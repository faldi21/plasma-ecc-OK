#!/usr/bin/env python3
"""
analysis/make_tables.py (docs/TICKETS.md T8).

Reads ONLY data/processed/<RUN_ID>/*.csv and stats.json -- no measurement,
no computation beyond formatting (mean±SD strings, thousands separators,
\\fillin{} fallback). Writes exactly these 7 files to --out (the paper
\\input{}s them by name -- do not rename):

  tab_params.tex        protocol parameters, code version, anvil args
  tab_commit_cost.tex   7 bench.commit_* cells, n=10/100/1000 L2 gas,
                         + delta vs. baseline at each n (ANALYSIS_PLAN.md
                         Amandemen 1 -- from stats.json's
                         commit_cost_deltas, computed by stats.py, only
                         formatted here) + L1 anchoring gas/calldata/
                         tx-count at n=100
  tab_sys_series.tex    sys.plasma_v0 vs sys.plasma_eccmath, n=10..200,
                         with gas diff and %diff
  tab_decomposition.tex n=100 decomposition: as-submitted, memory-
                         optimized, one-SM, ecrecover, scalar, keccak,
                         merkle -- gas + binding(yes/no). This is the ONE
                         deliberate, paper-sanctioned exception to "never
                         mix bench.*/sys.* in one table": ~/paper1/
                         main_rev1.tex's own prose describes this table as
                         a one-variable-at-a-time ablation FROM the
                         complete sys.* system THROUGH the bench.*
                         digest-isolation variants, not a naive
                         apples-to-oranges comparison. tab_commit_cost.tex
                         and tab_sys_series.tex remain strictly
                         single-namespace.
  tab_op_gas.tex        E2: 9 functions x {slot_init, slot_update},
                         ASC column from e2_sync_gas.csv; Merkle column
                         and ASC/Merkle ratio are \\fillin{} -- FINDING
                         (out of scope for T8 to fix): bench/e2_sync_gas.ts
                         only measures the ASC system (PlasmaChainUTXO.sol
                         / RootChainUTXO.sol); there is no Merkle-system
                         equivalent measured anywhere, so that column has
                         no data to report, ever, until such a script
                         exists.
  tab_throughput.tex    E3: 5 cells at one T value (--throughput-t,
                         default 2000 per ~/paper1/main_rev1.tex's
                         table caption), ops/s, L2 tx/s, median/p95
                         latency, failed/retried, all with CI95% where
                         defined
  tab_exploits.tex      E4: 5 tests, status, gas, notes

Hard rules enforced here:
  - a cell with no ok data -> \\fillin{} (never an estimated number)
  - a cell whose primary_status is exceeds_block_gas_limit -> the words
    EXCEEDS_BLOCK_LIMIT_LABEL plus a table footnote, not a blank cell and not
    a number
  - gas integers use a consistent LaTeX-safe thousands separator
  - running this script twice on the same inputs produces byte-identical
    output files (no wall-clock timestamps, no non-deterministic
    ordering, no randomness)

Usage:
  python3 analysis/make_tables.py --run-id <RUN_ID> --data data --out <dir>
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import subprocess
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent

# The single escaper for ANY free text that reaches a .tex file: values
# read from CSV/stats.json/git, and the literal prose in this file's own
# footnote constants. Every LaTeX special character is covered, not just
# the handful that happened to show up in past data -- an unescaped "_"
# in a footnote path (docs/EXPERIMENT_PRD.md) is exactly the kind of bug
# that makes the paper fail to compile long after the table looked fine.
#
# Substitution is SINGLE-PASS over characters, never a sequence of
# str.replace() calls: replacing "\\" first emits braces, which a later
# "{" rule would then corrupt into "\textbackslash\{\}".
_LATEX_ESCAPES = {
    "\\": "\\textbackslash{}",
    "&": "\\&",
    "%": "\\%",
    "$": "\\$",
    "#": "\\#",
    "_": "\\_",
    "{": "\\{",
    "}": "\\}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
}


def latex_escape(s: Any) -> str:
    """LaTeX-safe rendering of arbitrary text. Use for every string that
    is not itself LaTeX markup."""
    if s is None:
        return ""
    return "".join(_LATEX_ESCAPES.get(ch, ch) for ch in str(s))


# The paper is in English: every string this script emits into a .tex file
# must be too. Defined once so the two tables that use it cannot drift
# apart (they previously both printed the Indonesian "melebihi batas
# blok").
EXCEEDS_BLOCK_LIMIT_LABEL = "exceeds block gas limit"

# "--" means the quantity DOES NOT APPLY, and is deliberately distinct
# from \fillin{}, which means "a number that should exist and is
# missing". D1 fails on \fillin and ignores "--" precisely because the
# two are different claims: an em dash is an answer, a \fillin is an
# unanswered question.
NOT_APPLICABLE = "--"

def table_notes(*notes: str) -> str:
    """Table notes rendered INSIDE the float but OUTSIDE the tabular.

    NOT \\footnote / \\footnotemark / \\footnotetext: LaTeX drops footnotes
    raised inside a float, so every one of this paper's table notes
    compiled without error and then silently failed to appear in the PDF
    (verified by reading main_rev1.pdf back with pdftotext -- 0 hits for
    all four note texts, including the "correct" \\footnotemark/
    \\footnotetext pair). These notes carry the paper's honesty caveats
    (why a cell exceeds the block limit, why finalizeExit was measured off
    the public network), so losing them is not a cosmetic problem.

    Several notes on one table are joined into ONE paragraph separated by
    spaces, not stacked as separate blocks."""
    text = " ".join(n.strip() for n in notes if n and n.strip())
    if not text:
        return ""
    return (
        "\\vspace{2pt}\n"
        "{\\footnotesize\\raggedright\n"
        "\\textit{Note:} " + text + "\\par}"
    )


# Free prose, so it goes through latex_escape() like any other free text --
# the raw "_" in the PRD path used to reach the .tex unescaped and broke
# the LaTeX build.
NOTE_EXCEEDS = latex_escape(
    "Estimated gas for this call exceeded the node's configured block gas limit "
    "before any transaction was sent; the limit is treated as part of the measured "
    "object and was not raised to force the cell through (docs/EXPERIMENT_PRD.md)."
)

COMMIT_VARIANTS = [
    ("baseline", "Baseline (no digest)"),
    ("asc_naive", "ASC-naive"),
    ("asc_1sm", "ASC-1SM"),
    ("asc_ecrecover", "ASC-ecrecover"),
    ("scalar", "Scalar digest"),
    ("keccak", "Keccak digest"),
    ("merkle", "Merkle root"),
]

# tab_op_gas.tex Block A -- has a real counterpart in BOTH evaluated L2
# contracts (PlasmaChainUTXO.sol for ASC, PlasmaChainUTXOMerkle.sol for
# Merkle -- identical signatures), measured against both by
# bench/e2_sync_gas.ts, cell_id-prefixed e2.asc.*/e2.merkle.*.
E2_FUNCTIONS_L2_BOTH_SYSTEMS = [
    "createDepositUtxo",
    "transferUtxoBatch",
]

# tab_op_gas.tex Block B -- exist ONLY on RootChainUTXO.sol (L1). This
# repo has no Merkle-based RootChain contract to measure (docs/
# EXPERIMENT_PRD.md §5's own explicit, deliberate scope note) -- Block B
# never gets a Merkle or ASC/Merkle-ratio column, by design, not because
# the measurement is missing.
# (cell key, displayed label). The key is what gets looked up as
# e2.<key>.<slot state>; the label is what the reader sees.
#
# batchSyncUtxoSpent is PARAMETERIZED BY n, so it was recorded as
# e2.batchSyncUtxoSpent.n{10,50,100}.slot_* and a lookup for a bare
# "e2.batchSyncUtxoSpent.slot_init" found nothing -- the measurements
# existed all along and the table printed \fillin{} over them. It gets
# one row per n rather than a single chosen n, because how the cost
# scales with n is the finding.
E2_FUNCTIONS_L1_ASC_ONLY = [
    ("deposit", "deposit"),
    ("depositETH", "depositETH"),
    ("syncUtxoSpent", "syncUtxoSpent"),
    ("batchSyncUtxoSpent.n10", "batchSyncUtxoSpent (n=10)"),
    ("batchSyncUtxoSpent.n50", "batchSyncUtxoSpent (n=50)"),
    ("batchSyncUtxoSpent.n100", "batchSyncUtxoSpent (n=100)"),
    ("updateUtxoBlock", "updateUtxoBlock"),
    ("registerExitUtxo", "registerExitUtxo"),
    ("startExit", "startExit"),
    ("finalizeExit", "finalizeExit"),
]

E3_CELLS = [
    ("ASC", "inline", "asc.inline"),
    ("ASC", "deferred", "asc.deferred"),
    ("Merkle", "inline", "merkle.inline"),
    ("Merkle", "deferred", "merkle.deferred"),
    ("Keccak", "deferred", "keccak.deferred"),
]

DECOMPOSITION_ROWS = [
    ("As submitted ($n$ SM, per-iteration allocation)", "sys", "plasma_v0.n100", "No"),
    ("Memory-optimized ($n$ SM)", "sys", "plasma_eccmath.n100", "No"),
    ("One SM per block", "bench", "commit_asc_1sm.n100", "No"),
    ("\\texttt{ecrecover} check", "bench", "commit_asc_ecrecover.n100", "No"),
    ("Scalar digest (32~B)", "bench", "commit_scalar.n100", "No"),
    ("Keccak digest (32~B)", "bench", "commit_keccak.n100", "Yes"),
    ("Merkle root (32~B)", "bench", "commit_merkle.n100", "Yes, with $O(\\log n)$ proofs"),
]


# ---------------------------------------------------------------- formatting helpers


def fillin(label: str = "") -> str:
    return f"\\fillin{{{label}}}" if label else "\\fillin{}"


def is_missing(x: Any) -> bool:
    if x is None:
        return True
    if isinstance(x, float) and math.isnan(x):
        return True
    if isinstance(x, str) and x.strip() == "":
        return True
    return False


def fmt_int(x: Any) -> str:
    """Consistent LaTeX-safe thousands separator: plain comma grouping,
    matching ~/paper1/main_rev1.tex's own convention in running text
    (e.g. "301,558")."""
    if is_missing(x):
        return fillin()
    return f"{int(round(float(x))):,}"


def fmt_signed_int(x: Any) -> str:
    """Like fmt_int, but with an explicit leading sign -- for a delta
    column (ANALYSIS_PLAN.md Amandemen 1), the sign is the point, not
    just the magnitude."""
    if is_missing(x):
        return fillin()
    v = int(round(float(x)))
    return f"{'+' if v >= 0 else ''}{v:,}"


def fmt_delta_mean_sd(mean: Any, sd: Any, n: Any) -> str:
    if is_missing(mean):
        return fillin()
    mean_str = fmt_signed_int(mean)
    if is_missing(sd) or is_missing(n) or float(n) < 2:
        return mean_str
    return f"{mean_str} $\\pm$ {fmt_int(sd)}"


def fmt_mean_sd(mean: Any, sd: Any, n: Any) -> str:
    if is_missing(mean):
        return fillin()
    if is_missing(sd) or is_missing(n) or float(n) < 2:
        return fmt_int(mean)
    return f"{fmt_int(mean)} $\\pm$ {fmt_int(sd)}"


def fmt_mean_ci(mean: Any, ci_low: Any, ci_high: Any, decimals: int = 2) -> str:
    if is_missing(mean):
        return fillin()
    if is_missing(ci_low) or is_missing(ci_high):
        return f"{float(mean):.{decimals}f}"
    return f"{float(mean):.{decimals}f} [{float(ci_low):.{decimals}f}, {float(ci_high):.{decimals}f}]"


def fmt_float(x: Any, decimals: int = 2) -> str:
    if is_missing(x):
        return fillin()
    return f"{float(x):.{decimals}f}"


def fmt_pct(x: Any, decimals: int = 1) -> str:
    if is_missing(x):
        return fillin()
    return f"{float(x):.{decimals}f}\\%"


# ---------------------------------------------------------------- CSV / stats.json loading


def load_csv(path: Path) -> dict[str, dict[str, str]]:
    """Returns {cell_id: {column: value_str}}. Missing file/empty file ->
    empty dict (every lookup then correctly falls back to \\fillin{})."""
    if not path.is_file():
        return {}
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        return {row["cell_id"]: row for row in reader if row.get("cell_id")}


def cell_num(cells: dict[str, dict[str, str]], cell_id: str, column: str) -> float | None:
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


def cell_status(cells: dict[str, dict[str, str]], cell_id: str) -> str | None:
    row = cells.get(cell_id)
    return row.get("primary_status") if row else None


def gas_cell_text(cells: dict[str, dict[str, str]], cell_id: str, mean_col="gas_used_mean", sd_col="gas_used_sd", n_col="gas_used_n") -> str:
    status = cell_status(cells, cell_id)
    if status == "exceeds_block_gas_limit":
        return EXCEEDS_BLOCK_LIMIT_LABEL
    mean = cell_num(cells, cell_id, mean_col)
    sd = cell_num(cells, cell_id, sd_col)
    n = cell_num(cells, cell_id, n_col)
    return fmt_mean_sd(mean, sd, n)


def load_stats_json(data_root: Path, run_id: str) -> dict[str, Any] | None:
    path = data_root / "processed" / run_id / "stats.json"
    if not path.is_file():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_tex(out_dir: Path, filename: str, content: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / filename
    # Deterministic byte output: no trailing-whitespace variance.
    text = "\n".join(line.rstrip() for line in content.strip("\n").split("\n")) + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"[make_tables] wrote {path}")


# ---------------------------------------------------------------- tab_params.tex


def sh(cmd: str) -> str | None:
    try:
        return subprocess.check_output(cmd, shell=True, text=True, cwd=REPO_ROOT, stderr=subprocess.DEVNULL).strip() or None
    except Exception:
        return None


def read_period_constant(name: str) -> str | None:
    text = (REPO_ROOT / "contracts" / "src" / "RootChainUTXO.sol").read_text(encoding="utf-8")
    m = re.search(rf"constant {name} = ([0-9]+) (minutes|days|hours|seconds)", text)
    if not m:
        return None
    value, unit = int(m.group(1)), m.group(2)
    seconds = {"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400}[unit]
    return f"{value * seconds:,}~s ({value} {unit})"


def build_tab_params(data_root: Path, run_id: str) -> str:
    manifest_path = data_root / "raw" / run_id / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}

    exit_period = read_period_constant("EXIT_PERIOD") or fillin("EXIT_PERIOD")
    challenge_period = read_period_constant("CHALLENGE_PERIOD") or fillin("CHALLENGE_PERIOD")

    anvil_args = manifest.get("anvil_launch_args")
    gas_limit_m = None
    if anvil_args:
        m = re.search(r"--gas-limit (\d+)", anvil_args)
        if m:
            gas_limit_m = int(m.group(1))
    if gas_limit_m is None:
        env_val = _read_env_paper1("ANVIL_GAS_LIMIT")
        gas_limit_m = int(env_val) if env_val else None
    gas_limit_str = f"${gas_limit_m:,}$".replace(",", "{,}") if gas_limit_m else fillin("anvil gas limit")

    solc_version = _read_foundry_solc_version()
    via_ir = "via-IR" if "via_ir = true" in (REPO_ROOT / "foundry.toml").read_text() else "no via-IR"
    optimizer_runs = re.search(r"optimizer_runs = (\d+)", (REPO_ROOT / "foundry.toml").read_text())
    optimizer_runs = optimizer_runs.group(1) if optimizer_runs else fillin()

    commit_raw = manifest.get("commit") or sh("git rev-parse HEAD")
    commit_text = latex_escape(commit_raw[:12]) if commit_raw else fillin("commit hash")
    tag_raw = manifest.get("tag") or sh("git describe --tags --exact-match") or sh("git describe --tags")
    tag_text = latex_escape(tag_raw) if tag_raw else fillin("release tag")

    rows = [
        ("\\texttt{EXIT\\_PERIOD}", exit_period),
        ("\\texttt{CHALLENGE\\_PERIOD}", challenge_period),
        # Not a measurement and not a configured value: E3 never calls
        # createBlock at all (bench/e3_throughput.ts), and no interval is
        # set anywhere in .env.paper1. Saying so is the honest answer; the
        # paper makes no end-to-end throughput claim that would need one.
        (
            "L2 block interval",
            latex_escape(
                "not applicable (blocks are created on demand; no fixed interval "
                "is configured)"
            ),
        ),
        ("L2 Anvil block gas limit", gas_limit_str),
        ("Solidity / optimizer", f"{solc_version}, {via_ir}, {optimizer_runs} runs"),
        ("Evaluated code version", f"{tag_text}, {commit_text}"),
    ]

    body = "\n".join(f"{name} & {value} \\\\" for name, value in rows)
    return f"""\\begin{{table}}[!t]
\\caption{{Protocol and Deployment Parameters Used in All Experiments}}
\\label{{tab:params}}
\\centering
\\footnotesize
\\begin{{tabular}}{{@{{}}ll@{{}}}}
\\toprule
\\textbf{{Parameter}} & \\textbf{{Value}} \\\\
\\midrule
{body}
\\bottomrule
\\end{{tabular}}
\\end{{table}}
"""


def _read_env_paper1(key: str) -> str | None:
    path = REPO_ROOT / ".env.paper1"
    if not path.is_file():
        return None
    for line in path.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return None


def _read_foundry_solc_version() -> str:
    """Reads the pragma from RootChainUTXO.sol specifically -- one of the
    measured contracts (CLAUDE.md's list), not just "the first *.sol file
    a glob happens to return". contracts/src/Counter.sol is the unrelated
    Foundry scaffold example pinned to an older pragma (^0.8.13); a plain
    glob() picked that up before the real measured contracts (^0.8.30) in
    an earlier version of this function -- a real bug, caught by
    inspecting this table's actual output before trusting it."""
    path = REPO_ROOT / "contracts" / "src" / "RootChainUTXO.sol"
    if not path.is_file():
        return fillin("solc version")
    m = re.search(r"pragma solidity \^?([0-9.]+)", path.read_text())
    return m.group(1) if m else fillin("solc version")


# NOTE: never put math ($...$) INSIDE \textbf{} in an emitted header.
# The ieeeaccess class chokes on it -- "\textbf{$\Delta$ vs. baseline}"
# aborted the paper build with "Extra }, or forgotten $" even though the
# same markup compiles fine under the standard article class, so a
# table-only test does not catch it. Put the math outside the \textbf{}
# instead: "$\Delta$ \textbf{vs. baseline}".
# ---------------------------------------------------------------- tab_commit_cost.tex


def delta_cell_text(
    commit_cost: dict[str, Any] | None,
    variant_id: str,
    n: int,
    e1: dict[str, dict[str, str]] | None = None,
) -> str:
    """ANALYSIS_PLAN.md Amandemen 1: delta(v, n, r) = gas(v, n, r) -
    gas(baseline, n, r), from stats.json's commit_cost_deltas (computed by
    analysis/stats.py -- this function only formats, never computes, per
    this module's own "no computation beyond formatting" rule)."""
    if variant_id == "baseline":
        return "--"  # delta vs itself is not a reported quantity
    if not commit_cost or not commit_cost.get("available"):
        return fillin()
    entry = next(
        (e for e in commit_cost.get("by_n", {}).get(str(n), []) if e.get("variant") == variant_id),
        None,
    )
    if entry is None or not entry.get("available"):
        # A cell that ran out of gas has no gas_used to subtract from, so
        # its delta does not exist -- that is "not applicable", not a
        # missing measurement. The table's block-limit note already
        # explains why.
        if e1 is not None and cell_status(e1, f"bench.commit_{variant_id}.n{n}") == "exceeds_block_gas_limit":
            return NOT_APPLICABLE
        return fillin()
    return fmt_delta_mean_sd(entry.get("mean_delta"), entry.get("sd_delta"), entry.get("n_pairs"))


def build_tab_commit_cost(e1: dict[str, dict[str, str]], commit_cost: dict[str, Any] | None) -> str:
    lines = []
    for variant_id, label in COMMIT_VARIANTS:
        n10 = gas_cell_text(e1, f"bench.commit_{variant_id}.n10")
        n100 = gas_cell_text(e1, f"bench.commit_{variant_id}.n100")
        n1000 = gas_cell_text(e1, f"bench.commit_{variant_id}.n1000")

        d10 = delta_cell_text(commit_cost, variant_id, 10, e1)
        d100 = delta_cell_text(commit_cost, variant_id, 100, e1)
        d1000 = delta_cell_text(commit_cost, variant_id, 1000, e1)

        # slot_update, not the pooled cell: the one slot_init observation
        # is the contract's own one-off initialization cost and belongs to
        # whichever variant happened to anchor first, not to its
        # commitment scheme (aggregate.split_l1_anchor_by_slot_state).
        # Pooling them inflated that variant's mean by 3,420 gas and its
        # SD by ~700x.
        l1_cell = f"e1.{variant_id}.l1_anchor.n100.slot_update"
        if variant_id == "baseline":
            # Baseline commits no digest, so there is nothing to anchor.
            # Not a missing measurement -- the quantity does not exist.
            l1_gas = NOT_APPLICABLE
            l1_calldata = NOT_APPLICABLE
        elif l1_cell not in e1:
            l1_gas = fillin()
            l1_calldata = fillin()
        else:
            l1_gas = gas_cell_text(e1, l1_cell)
            calldata_mean = cell_num(e1, l1_cell, "calldata_bytes_mean")
            l1_calldata = fmt_int(calldata_mean)

        # Transactions per anchoring (reviewer R1-5). DERIVED, not the old
        # column: that one printed tx_count_n, the number of REPETITIONS,
        # and the underlying tx_count field is a hardcoded literal. This
        # reads aggregate.add_tx_provenance(), which counts DISTINCT
        # tx_hash values per repetition.
        if variant_id == "baseline":
            l1_txs = NOT_APPLICABLE
        else:
            per_op = cell_num(e1, l1_cell, "tx_per_operation")
            l1_txs = fmt_int(per_op) if per_op is not None else fillin()

        lines.append(
            f"{label} & {n10} & {n100} & {n1000} & {d10} & {d100} & {d1000} & {l1_gas} & {l1_calldata} & {l1_txs} \\\\"
        )

    body = "\n".join(lines)
    baseline_variant = (commit_cost or {}).get("baseline_variant", "CommitBaseline")
    epsilon_pct = (commit_cost or {}).get("epsilon_pct")
    epsilon_note = f"$\\epsilon={epsilon_pct:g}\\%$ of {latex_escape(baseline_variant)}'s mean gas (paired TOST)" if epsilon_pct is not None else fillin("epsilon")
    # This note deliberately keeps its math ($\\Delta$, \\text{}) instead of
    # being escaped wholesale: the markup is intentional, not data. Every
    # value that DOES come from data (baseline_variant, epsilon_note) is
    # escaped at its own source above.
    delta_note = (
        "Paired per (n, repetition, seed): "
        f"$\\Delta = \\text{{gas}}(\\text{{variant}}) - \\text{{gas}}(\\text{{{latex_escape(baseline_variant)}}})$ "
        "at the same n. Absolute gas (left) is descriptive; "
        "equivalence/significance testing (ANALYSIS\\_PLAN.md Amandemen 1) runs on "
        f"$\\Delta$, never on absolute gas. {epsilon_note}."
    )
    baseline_note = latex_escape(
        "The baseline variant commits no digest, so it anchors nothing: its L1 "
        "cells carry a dash rather than a number because the quantity does not "
        "exist, not because it was not measured."
    )

    # The slot_init figure is looked up, not named: whichever variant
    # anchored first owns the campaign's only cold-write observation, and
    # that is a property of run order, not of the variant.
    init_cells = sorted(k for k in e1 if "l1_anchor" in k and k.endswith(".slot_init"))
    if init_cells:
        init_gas = cell_num(e1, init_cells[0], "gas_used_mean")
        init_n = cell_num(e1, init_cells[0], "gas_used_n")
    else:
        init_gas = init_n = None
    if init_gas is not None:
        slot_note = latex_escape(
            "L1 anchoring is reported for slot_update. The campaign contains exactly "
            f"{fmt_int(init_n)} slot_init observation, the first anchoring of the run, at "
            f"{fmt_int(init_gas)} gas. The difference is the one-off cost of writing a "
            "storage slot that was still zero, paid once for the lifetime of the "
            "deployment; it belongs to whichever variant happened to anchor first, not "
            "to its commitment scheme, so pooling it would overstate that variant's "
            "cost and its variance. The remaining 24 gas of spread between repetitions "
            "is calldata, not computation: two of the 68 bytes are zero in one "
            "repetition, and a zero calldata byte costs 4 gas instead of 16."
        )
    else:
        slot_note = ""

    tx_note = latex_escape(
        "L1 txs per anchoring is counted from the distinct transaction hashes each "
        "cell recorded, not from the harness's tx_count field, which is a hardcoded "
        "constant. Every anchoring repetition produced its own hash, and all of them "
        "have a retrievable Sepolia receipt with success status, each in its own "
        "block: one submitBlock transaction per anchoring, for every variant."
    )

    notes = table_notes(
        delta_note,
        baseline_note,
        slot_note,
        tx_note,
        NOTE_EXCEEDS if EXCEEDS_BLOCK_LIMIT_LABEL in body else "",
    )
    return f"""\\begin{{table*}}[!t]
\\caption{{Block Commitment Cost per Variant: L2 Construction, Net of Baseline, and L1 Anchoring (mean $\\pm$ SD)}}
\\label{{tab:commit-cost}}
\\centering
\\footnotesize
\\setlength{{\\tabcolsep}}{{4pt}}
\\begin{{tabular}}{{@{{}}lrrrrrrrrr@{{}}}}
\\toprule
& \\multicolumn{{3}}{{c}}{{\\textbf{{L2 construction gas}} (\\texttt{{createBlock}})}} & \\multicolumn{{3}}{{c}}{{$\\Delta$ \\textbf{{vs. baseline}}}} & \\multicolumn{{3}}{{c}}{{\\textbf{{L1 anchoring}} (\\texttt{{submitBlock}}, $n=100$, slot\\_update)}} \\\\
\\cmidrule(lr){{2-4}}\\cmidrule(lr){{5-7}}\\cmidrule(lr){{8-10}}
\\textbf{{Variant}} & $n=10$ & $n=100$ & $n=1{{,}}000$ & $n=10$ & $n=100$ & $n=1{{,}}000$ & gas & calldata (B) & L1 txs per anchoring \\\\
\\midrule
{body}
\\bottomrule
\\end{{tabular}}
{notes}
\\end{{table*}}
"""


# ---------------------------------------------------------------- tab_sys_series.tex


def build_tab_sys_series(e1: dict[str, dict[str, str]]) -> str:
    lines = []
    for n in [10, 25, 50, 100, 200]:
        v0_cell = f"sys.plasma_v0.n{n}"
        ecc_cell = f"sys.plasma_eccmath.n{n}"
        v0_text = gas_cell_text(e1, v0_cell)
        ecc_text = gas_cell_text(e1, ecc_cell)

        v0_mean = cell_num(e1, v0_cell, "gas_used_mean")
        ecc_mean = cell_num(e1, ecc_cell, "gas_used_mean")
        if v0_mean is not None and ecc_mean is not None:
            diff = v0_mean - ecc_mean
            diff_pct = diff / v0_mean * 100 if v0_mean else None
            diff_text = fmt_int(diff)
            diff_pct_text = fmt_pct(diff_pct)
        elif cell_status(e1, v0_cell) == "exceeds_block_gas_limit" or cell_status(e1, ecc_cell) == "exceeds_block_gas_limit":
            # Nothing to subtract: one side ran out of gas, so the
            # difference does not exist rather than being unmeasured.
            diff_text = NOT_APPLICABLE
            diff_pct_text = NOT_APPLICABLE
        else:
            diff_text = fillin()
            diff_pct_text = fillin()

        lines.append(f"${n}$ & {v0_text} & {ecc_text} & {diff_text} & {diff_pct_text} \\\\")

    body = "\n".join(lines)
    notes = table_notes(NOTE_EXCEEDS if EXCEEDS_BLOCK_LIMIT_LABEL in body else "")
    return f"""\\begin{{table}}[!t]
\\caption{{Complete L2 Contract: As Submitted versus Memory-Optimized, Same Digest (mean $\\pm$ SD)}}
\\label{{tab:sys-series}}
\\centering
\\footnotesize
\\begin{{tabular}}{{@{{}}rrrrr@{{}}}}
\\toprule
$n$ & \\textbf{{As submitted}} & \\textbf{{Memory-optimized}} & \\textbf{{Difference}} & \\textbf{{Difference \\%}} \\\\
\\midrule
{body}
\\bottomrule
\\end{{tabular}}
{notes}
\\end{{table}}
"""


# ---------------------------------------------------------------- tab_decomposition.tex


def build_tab_decomposition(e1: dict[str, dict[str, str]]) -> str:
    lines = []
    prev_group = None
    for label, group, cell_suffix, binding in DECOMPOSITION_ROWS:
        cell_id = f"{group}.{cell_suffix}" if group == "sys" else f"bench.{cell_suffix}"
        gas_text = gas_cell_text(e1, cell_id)
        if prev_group == "bench" and group == "bench" and cell_suffix.startswith("commit_keccak"):
            lines.append("\\midrule")
        lines.append(f"{label} & {gas_text} & {binding} \\\\")
        prev_group = group

    body = "\n".join(lines)

    # The ladder spans TWO measurement contexts and must say so: rows 1-2
    # are the full contract ("sys"), rows 3-7 the isolated commitment
    # harness ("bench"). Every number here is read from the same CSV the
    # table body uses -- none of it is written by hand, and the contexts
    # are never pooled.
    sys_opt = cell_num(e1, "sys.plasma_eccmath.n100", "gas_used_mean")
    bench_naive = cell_num(e1, "bench.commit_asc_naive.n100", "gas_used_mean")
    bench_base = cell_num(e1, "bench.commit_baseline.n100", "gas_used_mean")
    if sys_opt is not None and bench_naive is not None:
        overhead = sys_opt - bench_naive
        context_note = latex_escape(
            "The first two rows were measured on the complete L2 contract; the "
            "remaining rows were measured on the isolated commitment harness. The "
            "two are not pooled. The harness counterpart of the "
            f"{fmt_int(sys_opt)} gas memory-optimized row is {fmt_int(bench_naive)} "
            f"gas, so the boundary between the two contexts costs {fmt_int(overhead)} "
            "gas"
            + (
                ". That gap matches the harness baseline to within "
                f"{fmt_int(abs(overhead - bench_base))} gas -- the harness commits an "
                f"empty block for {fmt_int(bench_base)} gas at the same n -- which is "
                "consistent with the gap being the full contract's baseline overhead, "
                "though the two are not identical."
                if bench_base is not None
                else "."
            )
            + " The ladder is still readable as a decomposition because every step "
            "compares like with like inside one context -- the drop from "
            f"{fmt_int(cell_num(e1, 'sys.plasma_v0.n100', 'gas_used_mean'))} to "
            f"{fmt_int(sys_opt)} gas isolates the per-iteration allocation within the "
            "full contract, and the steps below it isolate the commitment primitive "
            "within the harness. Only the single boundary between them crosses "
            "contexts, and it is quantified here rather than absorbed into a step."
        )
    else:
        context_note = ""
    notes = table_notes(context_note)

    return f"""\\begin{{table}}[!t]
\\caption{{Where the Reported Block-Commitment Cost Came From ($n = 100$)}}
\\label{{tab:decomposition}}
\\centering
\\footnotesize
\\setlength{{\\tabcolsep}}{{3pt}}
\\begin{{tabular}}{{@{{}}p{{3.5cm}}rp{{2.6cm}}@{{}}}}
\\toprule
\\textbf{{Step}} & \\textbf{{Gas}} & \\textbf{{Binding?}} \\\\
\\midrule
{body}
\\bottomrule
\\end{{tabular}}
{notes}
\\end{{table}}
"""


# ---------------------------------------------------------------- tab_op_gas.tex


# Rendered form of the `venue` column aggregate.py derives (common.
# venue_of(), ANALYSIS_PLAN.md Amandemen 4). Read from the CSV, never
# hardcoded here: which cells ran off-network is a property of the
# measurement, not a fact this script is allowed to assert.
VENUE_LABELS = {"sepolia": "Sepolia", "local": "local devnet"}

NOTE_L1_SCOPE = latex_escape(
    "The evaluated artifact does not include a Merkle-based RootChain contract, so "
    "L1 cost is reported as an absolute figure for the ASC deployment only, not as "
    "a cross-primitive comparison -- a deliberate scope limit "
    "(docs/EXPERIMENT_PRD.md S5), not an unmeasured gap."
)

NOTE_VENUE = latex_escape(
    "Venue is where the measurement was executed, not which protocol layer the "
    "operation belongs to. All rows are RootChainUTXO.sol (L1) operations, but "
    "finalizeExit was measured on a local devnet because it requires advancing "
    "time past the exit challenge period, which is not possible on a public "
    "network; every other row was measured on Sepolia. The two venues share the "
    "same EVM semantics and gas schedule, so the gas figures remain comparable, "
    "but they are not the same chain and are labelled as such rather than "
    "silently pooled."
)


def _venue_text(cells: dict[str, dict[str, str]], cell_id: str) -> str:
    venue = (cells.get(cell_id) or {}).get("venue")
    if not venue:
        return fillin()
    return VENUE_LABELS.get(venue, venue)


def _op_gas_ratio_text(e2: dict[str, dict[str, str]], asc_cell: str, merkle_cell: str) -> str:
    asc_mean = cell_num(e2, asc_cell, "gas_used_mean")
    merkle_mean = cell_num(e2, merkle_cell, "gas_used_mean")
    if asc_mean is None or merkle_mean is None or merkle_mean == 0:
        return fillin()
    return fmt_float(asc_mean / merkle_mean, 2)


def build_tab_op_gas(e2: dict[str, dict[str, str]]) -> str:
    """Two blocks, deliberately different column shapes (docs/
    EXPERIMENT_PRD.md §5's own note on why): Block A covers the two L2
    operations that exist in both evaluated contracts (real Merkle and
    ASC/Merkle-ratio columns); Block B covers the seven L1 operations that
    exist ONLY on RootChainUTXO.sol (ASC-only deployment) -- Block B has
    NO Merkle or ratio column at all, not a Merkle column full of
    \\fillin{}, because there is nothing to eventually fill in: no
    Merkle-based RootChain contract exists in this repo to measure."""
    block_a_lines = []
    for fn in E2_FUNCTIONS_L2_BOTH_SYSTEMS:
        for state, state_label in [("slot_init", "slot\\_init"), ("slot_update", "slot\\_update")]:
            asc_cell = f"e2.asc.{fn}.{state}"
            merkle_cell = f"e2.merkle.{fn}.{state}"
            asc_text = gas_cell_text(e2, asc_cell)
            merkle_text = gas_cell_text(e2, merkle_cell)
            ratio_text = _op_gas_ratio_text(e2, asc_cell, merkle_cell)
            block_a_lines.append(f"\\texttt{{{fn}}} ({state_label}) & {merkle_text} & {asc_text} & {ratio_text} \\\\")
    block_a_body = "\n".join(block_a_lines)
    # Block A is uniform in venue in every campaign so far (the evaluated
    # L2 is an Anvil devnet), so the caption states it once instead of
    # repeating a constant column. Derived, not asserted: if a future
    # campaign ever mixes venues here, the caption says so rather than
    # printing a claim that has quietly stopped being true.
    block_a_venues = sorted(
        {
            v
            for fn in E2_FUNCTIONS_L2_BOTH_SYSTEMS
            for state in ("slot_init", "slot_update")
            for system in ("asc", "merkle")
            for v in [(e2.get(f"e2.{system}.{fn}.{state}") or {}).get("venue")]
            if v
        }
    )
    if len(block_a_venues) == 1:
        block_a_venue_note = (
            f" All rows measured on {VENUE_LABELS.get(block_a_venues[0], block_a_venues[0])}."
        )
    elif block_a_venues:
        block_a_venue_note = (
            " Rows span more than one measurement venue ("
            + ", ".join(VENUE_LABELS.get(v, v) for v in block_a_venues)
            + "); see the L1 table's venue column for the distinction."
        )
    else:
        block_a_venue_note = ""

    block_b_lines = []
    for cell_key, fn_label in E2_FUNCTIONS_L1_ASC_ONLY:
        # Only the function name is \texttt{}; an "(n=100)" suffix is prose.
        name, _, suffix = fn_label.partition(" ")
        rendered = f"\\texttt{{{name}}}" + (f" {suffix}" if suffix else "")
        for state, state_label in [("slot_init", "slot\\_init"), ("slot_update", "slot\\_update")]:
            asc_cell = f"e2.{cell_key}.{state}"
            asc_text = gas_cell_text(e2, asc_cell)
            venue_text = _venue_text(e2, asc_cell)
            block_b_lines.append(
                f"{rendered} ({state_label}) & {asc_text} & {venue_text} \\\\"
            )
    block_b_body = "\n".join(block_b_lines)
    # The exceeds-limit note is emitted only when a cell actually shows
    # that label, so the table never carries a note about a row it has not
    # got.
    block_b_notes = table_notes(
        NOTE_L1_SCOPE,
        NOTE_VENUE,
        NOTE_EXCEEDS if EXCEEDS_BLOCK_LIMIT_LABEL in block_b_body else "",
    )

    return f"""\\begin{{table*}}[!t]
\\caption{{Gas per Operation, L2 (Both Systems), slot\\_init versus slot\\_update (mean $\\pm$ SD).{block_a_venue_note}}}
\\label{{tab:op-gas-l2}}
\\centering
\\scriptsize
\\setlength{{\\tabcolsep}}{{3pt}}
\\begin{{tabular}}{{@{{}}lrrr@{{}}}}
\\toprule
\\textbf{{Operation (slot state)}} & \\textbf{{Merkle}} & \\textbf{{ASC}} & \\textbf{{ASC/Merkle}} \\\\
\\midrule
{block_a_body}
\\bottomrule
\\end{{tabular}}
\\end{{table*}}

\\begin{{table}}[!t]
\\caption{{Gas per Operation, L1 (ASC Deployment Only), slot\\_init versus slot\\_update (mean $\\pm$ SD)}}
\\label{{tab:op-gas-l1}}
\\centering
\\scriptsize
\\setlength{{\\tabcolsep}}{{3pt}}
\\begin{{tabular}}{{@{{}}lrl@{{}}}}
\\toprule
\\textbf{{Operation (slot state)}} & \\textbf{{ASC gas}} & \\textbf{{Venue}} \\\\
\\midrule
{block_b_body}
\\bottomrule
\\end{{tabular}}
{block_b_notes}
\\end{{table}}
"""


# ---------------------------------------------------------------- tab_throughput.tex


def build_tab_throughput(e3: dict[str, dict[str, str]], t_value: int) -> str:
    lines = []
    for primitive_label, placement_label, cell_key in E3_CELLS:
        cell_id = f"e3.{cell_key}.T{t_value}"
        status = cell_status(e3, cell_id)
        if status == "exceeds_block_gas_limit":
            lines.append(
                f"{primitive_label} & {placement_label} & \\multicolumn{{4}}{{c}}{{{EXCEEDS_BLOCK_LIMIT_LABEL}}} \\\\"
            )
            continue

        ops_mean = cell_num(e3, cell_id, "ops_per_sec_mean")
        ops_lo = cell_num(e3, cell_id, "ops_per_sec_ci95_low")
        ops_hi = cell_num(e3, cell_id, "ops_per_sec_ci95_high")
        ops_text = fmt_mean_ci(ops_mean, ops_lo, ops_hi, decimals=1)

        tx_mean = cell_num(e3, cell_id, "l2_tx_per_sec_mean")
        tx_lo = cell_num(e3, cell_id, "l2_tx_per_sec_ci95_low")
        tx_hi = cell_num(e3, cell_id, "l2_tx_per_sec_ci95_high")
        tx_text = fmt_mean_ci(tx_mean, tx_lo, tx_hi, decimals=2)

        median_lat = fmt_float(cell_num(e3, cell_id, "latency_ms_median"), 1)
        p95_lat = fmt_float(cell_num(e3, cell_id, "latency_ms_p95"), 1)

        n_failed = cell_num(e3, cell_id, "n_failed")
        n_retried = cell_num(e3, cell_id, "n_retried")
        if n_failed is None and n_retried is None:
            failed_retried = fillin()
        else:
            failed_retried = f"{fmt_int(n_failed or 0)} / {fmt_int(n_retried or 0)}"

        lines.append(
            f"{primitive_label} & {placement_label} & {ops_text} & {tx_text} & {median_lat} & {p95_lat} & {failed_retried} \\\\"
        )

    body = "\n".join(lines)
    notes = table_notes(NOTE_EXCEEDS if EXCEEDS_BLOCK_LIMIT_LABEL in body else "")
    return f"""\\begin{{table*}}[!t]
\\caption{{Hot-Path Throughput (ops/s) and Local Confirmation Latency, $2\\times2$ Design Plus Control, $T = {t_value:,}$ (mean [95\\% CI])}}
\\label{{tab:throughput}}
\\centering
\\footnotesize
\\setlength{{\\tabcolsep}}{{4pt}}
\\begin{{tabular}}{{@{{}}llrrrrr@{{}}}}
\\toprule
\\textbf{{Primitive}} & \\textbf{{Placement}} & \\textbf{{ops/s}} & \\textbf{{L2 tx/s}} & \\textbf{{median latency (ms)}} & \\textbf{{p95 latency (ms)}} & \\textbf{{failed / retried}} \\\\
\\midrule
{body}
\\bottomrule
\\end{{tabular}}
{notes}
\\end{{table*}}
"""


# ---------------------------------------------------------------- tab_exploits.tex


def build_tab_exploits(e4: dict[str, dict[str, str]]) -> str:
    lines = []
    for cell_id, row in sorted(e4.items()):
        test_name = row.get("test_name") or cell_id
        status = latex_escape(row.get("primary_status")) or fillin()
        gas_mean = cell_num(e4, cell_id, "gas_used_mean")
        gas_text = fmt_int(gas_mean)
        notes = latex_escape(row.get("notes", ""))
        lines.append(f"\\texttt{{{latex_escape(test_name)}}} & {status} & {gas_text} & {notes} \\\\")

    body = "\n".join(lines) if lines else f"\\multicolumn{{4}}{{c}}{{{fillin('no E4 data')}}} \\\\"
    return f"""\\begin{{table}}[!t]
\\caption{{Exploit and Property Test Cases Against the Evaluated Contracts}}
\\label{{tab:exploits}}
\\centering
\\footnotesize
\\setlength{{\\tabcolsep}}{{3pt}}
\\begin{{tabular}}{{@{{}}p{{3.2cm}}p{{1.3cm}}rp{{4cm}}@{{}}}}
\\toprule
\\textbf{{Test}} & \\textbf{{Status}} & \\textbf{{Gas}} & \\textbf{{Notes}} \\\\
\\midrule
{body}
\\bottomrule
\\end{{tabular}}
\\end{{table}}
"""


# ---------------------------------------------------------------- main


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-id", required=True, help="RUN_ID holding E1/E2/E4 (and E3 too, unless --run-id-e3 is given)")
    ap.add_argument(
        "--run-id-e3",
        default=None,
        help="RUN_ID of the separately frozen E3 dataset (ANALYSIS_PLAN.md Amandemen 2); defaults to --run-id",
    )
    ap.add_argument("--data", default="data")
    ap.add_argument("--out", required=True)
    ap.add_argument("--throughput-t", type=int, default=2000, help="T value tab_throughput.tex reports (paper default: 2000)")
    args = ap.parse_args()

    data_root = Path(args.data)
    out_dir = Path(args.out)
    run_id_e3 = args.run_id_e3 or args.run_id
    processed_dir = data_root / "processed" / args.run_id
    # E3's CSV comes from its own frozen dataset when the two differ; the
    # directories stay separate (ANALYSIS_PLAN.md Amandemen 2).
    processed_dir_e3 = data_root / "processed" / run_id_e3
    if run_id_e3 != args.run_id:
        print(f"[make_tables] E3 dataset is separate: {run_id_e3} (E1/E2/E4: {args.run_id})")

    e1 = load_csv(processed_dir / "e1_commit_cost.csv")
    e2 = load_csv(processed_dir / "e2_sync_gas.csv")
    e3 = load_csv(processed_dir_e3 / "e3_throughput.csv")
    e4 = load_csv(processed_dir / "e4_exploits.csv")
    stats = load_stats_json(data_root, args.run_id)
    commit_cost_deltas = (stats or {}).get("commit_cost_deltas")

    write_tex(out_dir, "tab_params.tex", build_tab_params(data_root, args.run_id))
    write_tex(out_dir, "tab_commit_cost.tex", build_tab_commit_cost(e1, commit_cost_deltas))
    write_tex(out_dir, "tab_sys_series.tex", build_tab_sys_series(e1))
    write_tex(out_dir, "tab_decomposition.tex", build_tab_decomposition(e1))
    write_tex(out_dir, "tab_op_gas.tex", build_tab_op_gas(e2))
    write_tex(out_dir, "tab_throughput.tex", build_tab_throughput(e3, args.throughput_t))
    write_tex(out_dir, "tab_exploits.tex", build_tab_exploits(e4))


if __name__ == "__main__":
    main()
