#!/usr/bin/env python3
"""
analysis/make_tables.py (docs/TICKETS.md T8).

Reads ONLY data/processed/<RUN_ID>/*.csv and stats.json -- no measurement,
no computation beyond formatting (mean±SD strings, thousands separators,
\\fillin{} fallback). Writes exactly these 7 files to --out (the paper
\\input{}s them by name -- do not rename):

  tab_params.tex        protocol parameters, code version, anvil args
  tab_commit_cost.tex   7 bench.commit_* cells, n=10/100/1000 L2 gas,
                         + L1 anchoring gas/calldata/tx-count at n=100
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
    "melebihi batas blok" plus a table footnote, not a blank cell and not
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

FOOTNOTE_EXCEEDS = (
    "\\footnote{Estimated gas for this call exceeded the node's configured block gas limit "
    "before any transaction was sent; the limit is treated as part of the measured object and "
    "was not raised to force the cell through (docs/EXPERIMENT_PRD.md).}"
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

E2_FUNCTIONS = [
    "deposit",
    "depositETH",
    "createDepositUtxo",
    "transferUtxoBatch",
    "syncUtxoSpent",
    "batchSyncUtxoSpent",
    "updateUtxoBlock",
    "registerExitUtxo",
    "startExit",
    "finalizeExit",
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


def latex_escape(s: str) -> str:
    if s is None:
        return ""
    out = str(s)
    for a, b in [("\\", "\\textbackslash{}"), ("_", "\\_"), ("%", "\\%"), ("&", "\\&"), ("#", "\\#")]:
        out = out.replace(a, b)
    return out


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
        return "melebihi batas blok" + FOOTNOTE_EXCEEDS
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
        ("L2 block interval", fillin("value or trigger rule")),
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


# ---------------------------------------------------------------- tab_commit_cost.tex


def build_tab_commit_cost(e1: dict[str, dict[str, str]]) -> str:
    lines = []
    for variant_id, label in COMMIT_VARIANTS:
        n10 = gas_cell_text(e1, f"bench.commit_{variant_id}.n10")
        n100 = gas_cell_text(e1, f"bench.commit_{variant_id}.n100")
        n1000 = gas_cell_text(e1, f"bench.commit_{variant_id}.n1000")

        l1_cell = f"e1.{variant_id}.l1_anchor.n100"
        if variant_id == "baseline" or l1_cell not in e1:
            l1_gas = fillin()
            l1_calldata = fillin()
            l1_txs = fillin()
        else:
            l1_gas = gas_cell_text(e1, l1_cell)
            calldata_mean = cell_num(e1, l1_cell, "calldata_bytes_mean")
            l1_calldata = fmt_int(calldata_mean)
            tx_n = cell_num(e1, l1_cell, "tx_count_n")
            l1_txs = fmt_int(tx_n)

        lines.append(f"{label} & {n10} & {n100} & {n1000} & {l1_gas} & {l1_calldata} & {l1_txs} \\\\")

    body = "\n".join(lines)
    return f"""\\begin{{table*}}[!t]
\\caption{{Block Commitment Cost per Variant: L2 Construction versus L1 Anchoring (mean $\\pm$ SD)}}
\\label{{tab:commit-cost}}
\\centering
\\footnotesize
\\setlength{{\\tabcolsep}}{{4pt}}
\\begin{{tabular}}{{@{{}}lrrrrrr@{{}}}}
\\toprule
& \\multicolumn{{3}}{{c}}{{\\textbf{{L2 construction gas}} (\\texttt{{createBlock}})}} & \\multicolumn{{3}}{{c}}{{\\textbf{{L1 anchoring}} (\\texttt{{submitBlock}}, $n=100$)}} \\\\
\\cmidrule(lr){{2-4}}\\cmidrule(lr){{5-7}}
\\textbf{{Variant}} & $n=10$ & $n=100$ & $n=1{{,}}000$ & gas & calldata (B) & L1 txs \\\\
\\midrule
{body}
\\bottomrule
\\end{{tabular}}
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
        else:
            diff_text = fillin()
            diff_pct_text = fillin()

        lines.append(f"${n}$ & {v0_text} & {ecc_text} & {diff_text} & {diff_pct_text} \\\\")

    body = "\n".join(lines)
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
\\end{{table}}
"""


# ---------------------------------------------------------------- tab_op_gas.tex


def build_tab_op_gas(e2: dict[str, dict[str, str]]) -> str:
    lines = []
    for fn in E2_FUNCTIONS:
        init_cell = f"e2.{fn}.slot_init"
        update_cell = f"e2.{fn}.slot_update"
        asc_init = gas_cell_text(e2, init_cell)
        asc_update = gas_cell_text(e2, update_cell)
        # No Merkle-system equivalent is measured anywhere in this repo
        # (see this module's docblock) -- always \fillin{}, never invented.
        merkle_init = fillin()
        merkle_update = fillin()
        ratio_init = fillin()
        ratio_update = fillin()
        lines.append(
            f"\\texttt{{{fn}}} (slot\\_init) & {merkle_init} & {asc_init} & {ratio_init} \\\\\n"
            f"\\texttt{{{fn}}} (slot\\_update) & {merkle_update} & {asc_update} & {ratio_update} \\\\"
        )

    body = "\n".join(lines)
    return f"""\\begin{{table*}}[!t]
\\caption{{Gas per Operation, slot\\_init versus slot\\_update (mean $\\pm$ SD)}}
\\label{{tab:op-gas}}
\\centering
\\scriptsize
\\setlength{{\\tabcolsep}}{{3pt}}
\\begin{{tabular}}{{@{{}}lrrr@{{}}}}
\\toprule
\\textbf{{Operation (slot state)}} & \\textbf{{Merkle}} & \\textbf{{ASC}} & \\textbf{{ASC/Merkle}} \\\\
\\midrule
{body}
\\bottomrule
\\end{{tabular}}
\\end{{table*}}
"""


# ---------------------------------------------------------------- tab_throughput.tex


def build_tab_throughput(e3: dict[str, dict[str, str]], t_value: int) -> str:
    lines = []
    for primitive_label, placement_label, cell_key in E3_CELLS:
        cell_id = f"e3.{cell_key}.T{t_value}"
        status = cell_status(e3, cell_id)
        if status == "exceeds_block_gas_limit":
            lines.append(
                f"{primitive_label} & {placement_label} & \\multicolumn{{4}}{{c}}{{melebihi batas blok}}{FOOTNOTE_EXCEEDS} \\\\"
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
\\end{{table*}}
"""


# ---------------------------------------------------------------- tab_exploits.tex


def build_tab_exploits(e4: dict[str, dict[str, str]]) -> str:
    lines = []
    for cell_id, row in sorted(e4.items()):
        test_name = row.get("test_name") or cell_id
        status = row.get("primary_status") or fillin()
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
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--data", default="data")
    ap.add_argument("--out", required=True)
    ap.add_argument("--throughput-t", type=int, default=2000, help="T value tab_throughput.tex reports (paper default: 2000)")
    args = ap.parse_args()

    data_root = Path(args.data)
    out_dir = Path(args.out)
    processed_dir = data_root / "processed" / args.run_id

    e1 = load_csv(processed_dir / "e1_commit_cost.csv")
    e2 = load_csv(processed_dir / "e2_sync_gas.csv")
    e3 = load_csv(processed_dir / "e3_throughput.csv")
    e4 = load_csv(processed_dir / "e4_exploits.csv")

    write_tex(out_dir, "tab_params.tex", build_tab_params(data_root, args.run_id))
    write_tex(out_dir, "tab_commit_cost.tex", build_tab_commit_cost(e1))
    write_tex(out_dir, "tab_sys_series.tex", build_tab_sys_series(e1))
    write_tex(out_dir, "tab_decomposition.tex", build_tab_decomposition(e1))
    write_tex(out_dir, "tab_op_gas.tex", build_tab_op_gas(e2))
    write_tex(out_dir, "tab_throughput.tex", build_tab_throughput(e3, args.throughput_t))
    write_tex(out_dir, "tab_exploits.tex", build_tab_exploits(e4))


if __name__ == "__main__":
    main()
