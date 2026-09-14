#!/usr/bin/env python3
"""
analysis/stats.py (docs/TICKETS.md T8; docs/EXPERIMENT_PRD.md §7.2-7.4).

Reads data/processed/<RUN_ID>/e3_throughput_by_rep.csv (raw per-repetition
ops/s -- see aggregate.py's e3_by_repetition_rows docblock for why the
per-cell SUMMARY csv isn't enough here) and ANALYSIS_PLAN.md's frozen
`analysis_plan.yml` block, and writes data/processed/<RUN_ID>/stats.json:

  - two-way ANOVA on ops/s at ANALYSIS_PLAN's anova_t_value (Primitive x
    Placement), F/df/p/partial eta squared per effect
  - each contrast in ANALYSIS_PLAN's main_contrasts, at every T value
    present in the data: Welch t-test, Mann-Whitney U, Cohen's d, CI95%
    mean difference, Shapiro-Wilk (both groups), Levene, TOST equivalence
    (epsilon = ANALYSIS_PLAN's equivalence_epsilon_pct% of the reference
    cell's mean at that T), and (only for the placement contrast) a
    bootstrap ratio CI
  - Holm-Bonferroni correction applied within each T value's group of
    contrasts (docs/EXPERIMENT_PRD.md §7.2: "Holm across semua kontras
    yang dilaporkan dalam satu tabel" -- one T value's contrasts are one
    table)

Never silently swaps which test is "primary" after seeing a p-value
(CLAUDE.md IRON RULE 6): normality/homoscedasticity (Shapiro-Wilk/Levene)
alone decide recommended_primary_test = "welch_or_mannwhitney" vs "anova",
computed the same way regardless of what the p-values turn out to be.

A contrast or the ANOVA that doesn't have enough data (e.g. a smoke run
with only T=500, or a cell with < 2 ok repetitions) is reported with
available=false and a reason -- never fabricated, extrapolated, or
silently omitted (CLAUDE.md IRON RULE 1).

Amandemen 1 (ANALYSIS_PLAN.md, 2026-09-14 frozen dataset trigger --
2026-09-15): a second net-of-baseline analysis for E1's bench.commit_*
cells, added here alongside the E3 analysis above (independent of it --
either can run with the other's input missing, see load_by_rep/
load_e1_commit_records tolerating a missing file):

  - delta(v, n, r) = gas(v, n, r) - gas(CommitBaseline, n, r), paired by
    (n, repetition, seed) using the raw data/raw/<RUN_ID>/
    e1_commit_cost.jsonl records directly (aggregate.py's e1_commit_cost.csv
    is a per-cell summary across repetitions and cannot reconstruct this
    pairing) -- reported in stats.json's "commit_cost_deltas" key.
  - TOST equivalence is a PAIRED test (statsmodels' ttost_paired) against
    ANALYSIS_PLAN's commit_cost_equivalence_epsilon_pct% of
    CommitBaseline's own mean gas at that n; Holm-Bonferroni is applied
    once per n, across every non-baseline variant with data at that n
    (reusing holm_correct() unchanged); the bootstrap CI is on mean(delta)
    itself (resampling paired indices), not a ratio.
  - sys.plasma_* is NEVER included here (ANALYSIS_PLAN.md Amandemen 1 §3):
    total gas is what matters there, not a primitive isolated net of
    shared bookkeeping.

Usage:
  python3 analysis/stats.py --run-id <RUN_ID> --data data
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yaml
from scipy import stats as sp_stats
from statsmodels.formula.api import ols
from statsmodels.stats.anova import anova_lm
from statsmodels.stats.weightstats import ttost_ind, ttost_paired

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import OK_STATUSES, read_jsonl

REPO_ROOT = Path(__file__).resolve().parent.parent

CELL_ID_RE = re.compile(r"^e3\.(?P<cell>[a-z_]+\.[a-z_]+)\.T(?P<t>\d+)$")
COMMIT_CELL_RE = re.compile(r"^bench\.commit_(?P<variant>[a-z0-9_]+)\.n(?P<n>\d+)$")


def load_analysis_plan(repo_root: Path) -> dict[str, Any]:
    """Merges every ```yaml``` fenced block in ANALYSIS_PLAN.md, in
    document order (later blocks' keys win only on an actual name
    collision -- an amendment section adds new keys, it never needs to
    redefine an existing one). This is how Amandemen 1's separate block
    reaches this script without touching Bagian 5's original frozen
    block byte-for-byte (IRON RULE 6: amend by adding, never overwrite)."""
    plan_path = repo_root / "ANALYSIS_PLAN.md"
    text = plan_path.read_text(encoding="utf-8")
    blocks = re.findall(r"```yaml\n(.*?)\n```", text, re.DOTALL)
    if not blocks:
        raise ValueError(f"{plan_path}: could not find any frozen ```yaml``` block")
    merged: dict[str, Any] = {}
    for block in blocks:
        merged.update(yaml.safe_load(block) or {})
    return merged


def load_by_rep(data_root: Path, run_id: str) -> pd.DataFrame:
    """Empty DataFrame (not an error) when e3_throughput_by_rep.csv is
    absent -- aggregate.py only writes it when e3_throughput.jsonl exists
    for this RUN_ID, so a RUN_ID with only E1 data is legitimate input
    here, not a failure (the commit_cost_deltas analysis below is
    independent of this one)."""
    path = data_root / "processed" / run_id / "e3_throughput_by_rep.csv"
    if not path.is_file():
        return pd.DataFrame()
    df = pd.read_csv(path)
    if df.empty:
        return df
    parsed = df["cell_id"].str.extract(CELL_ID_RE)
    df["cell"] = parsed["cell"]
    df["t_value"] = pd.to_numeric(parsed["t"], errors="coerce")
    primitive_placement = df["cell"].str.split(".", n=1, expand=True)
    df["primitive"] = primitive_placement[0]
    df["placement"] = primitive_placement[1] if primitive_placement.shape[1] > 1 else None
    return df


def cohens_d(a: np.ndarray, b: np.ndarray) -> float | None:
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return None
    pooled_var = ((na - 1) * a.var(ddof=1) + (nb - 1) * b.var(ddof=1)) / (na + nb - 2)
    if pooled_var <= 0:
        return None
    return float((b.mean() - a.mean()) / np.sqrt(pooled_var))


def mean_diff_ci95(a: np.ndarray, b: np.ndarray) -> tuple[float, float] | None:
    """Welch-style CI for (mean_b - mean_a), matching ttest_ind(equal_var=False)."""
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return None
    se = np.sqrt(a.var(ddof=1) / na + b.var(ddof=1) / nb)
    if se == 0:
        return None
    # Welch-Satterthwaite df
    df = (a.var(ddof=1) / na + b.var(ddof=1) / nb) ** 2 / (
        (a.var(ddof=1) / na) ** 2 / (na - 1) + (b.var(ddof=1) / nb) ** 2 / (nb - 1)
    )
    tcrit = sp_stats.t.ppf(0.975, df=df)
    diff = b.mean() - a.mean()
    return float(diff - tcrit * se), float(diff + tcrit * se)


def bootstrap_ratio_ci(a: np.ndarray, b: np.ndarray, resamples: int, seed: int) -> dict[str, Any] | None:
    """CI95% of mean(b)/mean(a) via seeded bootstrap resampling (docs/
    EXPERIMENT_PRD.md §7.2's "rasio + CI (bootstrap 10.000 resample)")."""
    if len(a) < 2 or len(b) < 2 or a.mean() == 0:
        return None
    rng = np.random.default_rng(seed)
    ratios = np.empty(resamples)
    for i in range(resamples):
        ra = rng.choice(a, size=len(a), replace=True)
        rb = rng.choice(b, size=len(b), replace=True)
        ratios[i] = rb.mean() / ra.mean() if ra.mean() != 0 else np.nan
    ratios = ratios[~np.isnan(ratios)]
    return {
        "ratio": float(b.mean() / a.mean()),
        "ci95_low": float(np.percentile(ratios, 2.5)),
        "ci95_high": float(np.percentile(ratios, 97.5)),
        "resamples": int(len(ratios)),
        "seed": seed,
    }


def run_contrast(
    df: pd.DataFrame,
    contrast_id: str,
    cell_a: str,
    cell_b: str,
    t_value: int,
    alpha: float,
    epsilon_pct: float,
    reference_cell: str,
    include_bootstrap_ratio: bool,
    bootstrap_resamples: int,
    bootstrap_seed: int,
) -> dict[str, Any]:
    a = df[(df["cell"] == cell_a) & (df["t_value"] == t_value)]["ops_per_sec"].to_numpy()
    b = df[(df["cell"] == cell_b) & (df["t_value"] == t_value)]["ops_per_sec"].to_numpy()

    result: dict[str, Any] = {
        "id": contrast_id,
        "t_value": int(t_value),
        "cell_a": cell_a,
        "cell_b": cell_b,
        "n_a": int(len(a)),
        "n_b": int(len(b)),
    }

    if len(a) < 2 or len(b) < 2:
        result["available"] = False
        result["reason_unavailable"] = f"n_a={len(a)}, n_b={len(b)} -- need >=2 ok repetitions in each group"
        return result

    result["available"] = True
    result["mean_a"] = float(a.mean())
    result["mean_b"] = float(b.mean())

    welch = sp_stats.ttest_ind(a, b, equal_var=False)
    result["welch_t"] = {"statistic": float(welch.statistic), "p": float(welch.pvalue)}

    mwu = sp_stats.mannwhitneyu(a, b, alternative="two-sided")
    result["mann_whitney_u"] = {"statistic": float(mwu.statistic), "p": float(mwu.pvalue)}

    result["cohens_d"] = cohens_d(a, b)
    diff_ci = mean_diff_ci95(a, b)
    result["mean_diff"] = float(b.mean() - a.mean())
    result["mean_diff_ci95"] = list(diff_ci) if diff_ci else None

    shapiro_a = sp_stats.shapiro(a) if len(a) >= 3 else None
    shapiro_b = sp_stats.shapiro(b) if len(b) >= 3 else None
    result["shapiro_a"] = {"statistic": float(shapiro_a.statistic), "p": float(shapiro_a.pvalue)} if shapiro_a else None
    result["shapiro_b"] = {"statistic": float(shapiro_b.statistic), "p": float(shapiro_b.pvalue)} if shapiro_b else None
    levene = sp_stats.levene(a, b)
    result["levene"] = {"statistic": float(levene.statistic), "p": float(levene.pvalue)}

    normal = (shapiro_a is None or shapiro_a.pvalue >= alpha) and (shapiro_b is None or shapiro_b.pvalue >= alpha)
    homoscedastic = levene.pvalue >= alpha
    result["assumptions_violated"] = not (normal and homoscedastic)
    # Decided purely from the assumption checks above, never from which
    # test gives a "nicer" p-value (docs/EXPERIMENT_PRD.md §7.3).
    result["recommended_primary_test"] = "mann_whitney_u" if result["assumptions_violated"] else "welch_t"

    # TOST equivalence: epsilon is an ABSOLUTE band derived from the
    # reference cell's mean (ANALYSIS_PLAN.md §4), applied to the raw
    # ops/s values of this specific contrast's two groups.
    ref_vals = df[(df["cell"] == reference_cell) & (df["t_value"] == t_value)]["ops_per_sec"].to_numpy()
    if len(ref_vals) >= 1:
        epsilon_abs = (epsilon_pct / 100.0) * float(ref_vals.mean())
        tost_p, (t1, p1, df1), (t2, p2, df2) = ttost_ind(a, b, -epsilon_abs, epsilon_abs, usevar="unequal")
        equivalent = bool(tost_p < alpha)
        result["tost"] = {
            "epsilon_pct": epsilon_pct,
            "epsilon_abs": epsilon_abs,
            "reference_cell": reference_cell,
            "reference_mean": float(ref_vals.mean()),
            "p": float(tost_p),
            "equivalent": equivalent,
        }
        mean_diff_pct = (b.mean() - a.mean()) / float(ref_vals.mean()) * 100.0
        boot_pct = _bootstrap_pct_diff_ci(a, b, float(ref_vals.mean()), bootstrap_resamples, bootstrap_seed)
        result["mean_diff_pct"] = float(mean_diff_pct)
        result["mean_diff_pct_ci95"] = boot_pct
    else:
        result["tost"] = None
        equivalent = False

    if result["recommended_primary_test"] == "welch_t":
        primary_p = result["welch_t"]["p"]
    else:
        primary_p = result["mann_whitney_u"]["p"]
    result["primary_p"] = primary_p
    if primary_p < alpha:
        result["conclusion"] = "significantly_different"
    elif equivalent:
        result["conclusion"] = "practically_equivalent"
    else:
        result["conclusion"] = "inconclusive_at_this_n"

    if include_bootstrap_ratio:
        result["bootstrap_ratio"] = bootstrap_ratio_ci(a, b, bootstrap_resamples, bootstrap_seed)

    return result


def _bootstrap_pct_diff_ci(a: np.ndarray, b: np.ndarray, ref_mean: float, resamples: int, seed: int) -> list[float] | None:
    if ref_mean == 0:
        return None
    rng = np.random.default_rng(seed + 1)  # distinct stream from the ratio bootstrap
    diffs = np.empty(resamples)
    for i in range(resamples):
        ra = rng.choice(a, size=len(a), replace=True)
        rb = rng.choice(b, size=len(b), replace=True)
        diffs[i] = (rb.mean() - ra.mean()) / ref_mean * 100.0
    return [float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))]


def holm_correct(results: list[dict[str, Any]]) -> None:
    """Holm-Bonferroni across `results`' primary_p, in place, skipping
    entries with available=False (nothing to correct)."""
    indexed = [(i, r["primary_p"]) for i, r in enumerate(results) if r.get("available") and r.get("primary_p") is not None]
    if not indexed:
        return
    ordered = sorted(indexed, key=lambda x: x[1])
    m = len(ordered)
    running_max = 0.0
    for rank, (idx, p) in enumerate(ordered):
        adjusted = min(1.0, (m - rank) * p)
        running_max = max(running_max, adjusted)
        results[idx]["holm_adjusted_p"] = running_max


# ---------------------------------------------------------------- Amandemen 1: net-of-baseline (E1 bench.commit_*)


def load_e1_commit_records(data_root: Path, run_id: str) -> list[dict[str, Any]]:
    """Raw records, not the aggregated CSV -- delta needs per-(repetition,
    seed) pairing that a per-cell mean/SD summary cannot reconstruct.
    Reading data/raw/ directly is read-only, never a write (CLAUDE.md IRON
    RULE 2 only forbids writing/modifying it)."""
    path = data_root / "raw" / run_id / "e1_commit_cost.jsonl"
    if not path.is_file():
        return []
    return read_jsonl(path)


def run_commit_cost_deltas(
    records: list[dict[str, Any]],
    baseline_variant: str,
    epsilon_pct: float,
    alpha: float,
    bootstrap_resamples: int,
    bootstrap_seed: int,
) -> dict[str, Any]:
    """ANALYSIS_PLAN.md Amandemen 1 §2: delta(v, n, r) = gas(v, n, r) -
    gas(baseline, n, r), paired per (n, repetition, seed); TOST, Holm (one
    family per n), and bootstrap CI all run on delta, never on absolute
    gas. sys.plasma_* is never in `records` here -- callers only load
    e1_commit_cost.jsonl (sys.* lives in the same file but its cell_id
    doesn't match COMMIT_CELL_RE, so it's naturally excluded, not
    filtered by a separate check)."""
    if not records:
        return {"available": False, "reason_unavailable": "e1_commit_cost.jsonl not found or empty for this RUN_ID"}

    # (variant, n) -> {(repetition, seed): gas_used}, "ok" records only.
    by_variant_n: dict[tuple[str, int], dict[tuple[Any, Any], float]] = {}
    for r in records:
        if r.get("status") not in OK_STATUSES:
            continue
        m = COMMIT_CELL_RE.match(r.get("cell_id") or "")
        if not m:
            continue
        if r.get("gas_used") is None:
            continue
        key = (r.get("repetition"), r.get("seed"))
        by_variant_n.setdefault((m.group("variant"), int(m.group("n"))), {})[key] = float(r["gas_used"])

    n_values = sorted({n for (_v, n) in by_variant_n})
    variants = sorted({v for (v, n) in by_variant_n if v != baseline_variant})

    if not n_values:
        return {"available": False, "reason_unavailable": "no ok bench.commit_* records found"}

    by_n: dict[str, list[dict[str, Any]]] = {}
    for n in n_values:
        baseline_map = by_variant_n.get((baseline_variant, n), {})
        results: list[dict[str, Any]] = []
        for variant in variants:
            variant_map = by_variant_n.get((variant, n), {})
            shared_keys = sorted(set(variant_map) & set(baseline_map), key=str)
            entry: dict[str, Any] = {
                "variant": variant,
                "cell_id": f"bench.commit_{variant}.n{n}",
                "n_pairs": len(shared_keys),
            }
            if len(shared_keys) < 2:
                entry["available"] = False
                entry["reason_unavailable"] = (
                    f"n_pairs={len(shared_keys)} -- need >=2 paired (repetition, seed) with both "
                    f"{variant} and {baseline_variant} ok at n={n}"
                )
                results.append(entry)
                continue

            variant_vals = np.array([variant_map[k] for k in shared_keys])
            baseline_vals = np.array([baseline_map[k] for k in shared_keys])
            delta = variant_vals - baseline_vals

            entry["available"] = True
            entry["mean_gas"] = float(variant_vals.mean())
            entry["mean_delta"] = float(delta.mean())
            entry["sd_delta"] = float(delta.std(ddof=1)) if len(delta) > 1 else None

            shapiro = sp_stats.shapiro(delta) if len(delta) >= 3 else None
            entry["shapiro_delta"] = {"statistic": float(shapiro.statistic), "p": float(shapiro.pvalue)} if shapiro else None
            normal = shapiro is None or shapiro.pvalue >= alpha
            # Paired-t vs Wilcoxon signed-rank, decided purely from the
            # normality check above -- same "never pick after seeing the
            # p-value" discipline as run_contrast's Welch-vs-Mann-Whitney
            # choice (ANALYSIS_PLAN.md §3).
            if normal:
                primary = sp_stats.ttest_rel(variant_vals, baseline_vals)
                entry["primary_test"] = "paired_t"
                entry["primary_p"] = float(primary.pvalue)
            else:
                signed_rank = sp_stats.wilcoxon(delta)
                entry["primary_test"] = "wilcoxon_signed_rank"
                entry["primary_p"] = float(signed_rank.pvalue)

            # Paired TOST (statsmodels' ttost_paired): epsilon is an
            # ABSOLUTE band derived from the baseline's own mean gas at
            # this n (ANALYSIS_PLAN.md Amandemen 1 §2) -- delta is already
            # paired, so this is not the independent-samples ttost_ind
            # run_contrast uses for E3.
            eps_abs = (epsilon_pct / 100.0) * float(baseline_vals.mean())
            tost_p, _lower, _upper = ttost_paired(variant_vals, baseline_vals, -eps_abs, eps_abs)
            equivalent = bool(tost_p < alpha)
            entry["tost"] = {
                "epsilon_pct": epsilon_pct,
                "epsilon_abs": eps_abs,
                "reference": baseline_variant,
                "reference_mean": float(baseline_vals.mean()),
                "p": float(tost_p),
                "equivalent": equivalent,
            }

            rng = np.random.default_rng(bootstrap_seed)
            n_pairs = len(delta)
            boot_means = np.empty(bootstrap_resamples)
            for i in range(bootstrap_resamples):
                idx = rng.integers(0, n_pairs, size=n_pairs)
                boot_means[i] = delta[idx].mean()
            entry["mean_delta_ci95_bootstrap"] = [
                float(np.percentile(boot_means, 2.5)),
                float(np.percentile(boot_means, 97.5)),
            ]

            if entry["primary_p"] < alpha:
                entry["conclusion"] = "significantly_different_from_baseline"
            elif equivalent:
                entry["conclusion"] = "practically_equivalent_to_baseline"
            else:
                entry["conclusion"] = "inconclusive_at_this_n"

            results.append(entry)

        holm_correct(results)  # one Holm family per n, across this n's non-baseline variants
        by_n[str(n)] = results

    return {
        "available": True,
        "baseline_variant": baseline_variant,
        "epsilon_pct": epsilon_pct,
        "by_n": by_n,
    }


def run_anova(df: pd.DataFrame, t_value: int, primitives: list[str], placements: list[str], alpha: float) -> dict[str, Any]:
    subset = df[(df["t_value"] == t_value) & df["primitive"].isin(primitives) & df["placement"].isin(placements)].copy()
    counts = subset.groupby(["primitive", "placement"]).size()
    n_per_cell = {f"{p}.{pl}": int(n) for (p, pl), n in counts.items()}
    needed_cells = [f"{p}.{pl}" for p in primitives for pl in placements]
    missing = [c for c in needed_cells if n_per_cell.get(c, 0) < 2]
    if missing:
        return {
            "t_value": t_value,
            "available": False,
            "reason_unavailable": f"need >=2 ok repetitions per (primitive,placement) cell; missing/short: {missing}",
            "n_per_cell": n_per_cell,
        }

    model = ols("ops_per_sec ~ C(primitive) * C(placement)", data=subset).fit()
    table = anova_lm(model, typ=2)
    ss_resid = table.loc["Residual", "sum_sq"]

    def effect_row(label: str) -> dict[str, Any]:
        ss = table.loc[label, "sum_sq"]
        df1 = table.loc[label, "df"]
        df2 = table.loc["Residual", "df"]
        f = table.loc[label, "F"]
        p = table.loc[label, "PR(>F)"]
        partial_eta_sq = ss / (ss + ss_resid) if (ss + ss_resid) > 0 else None
        return {
            "F": float(f),
            "df1": float(df1),
            "df2": float(df2),
            "p": float(p),
            "partial_eta_sq": float(partial_eta_sq) if partial_eta_sq is not None else None,
        }

    return {
        "t_value": t_value,
        "available": True,
        "n_per_cell": n_per_cell,
        "primitive_effect": effect_row("C(primitive)"),
        "placement_effect": effect_row("C(placement)"),
        "interaction_effect": effect_row("C(primitive):C(placement)"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--data", default="data")
    args = ap.parse_args()

    plan = load_analysis_plan(REPO_ROOT)
    alpha = plan["alpha"]
    epsilon_pct = plan["equivalence_epsilon_pct"]
    reference_cell = plan["equivalence_reference_cell"]
    bootstrap_resamples = plan["bootstrap_resamples"]
    bootstrap_seed = plan["bootstrap_seed"]
    anova_t_value = plan["anova_t_value"]
    primitives = plan["anova_factors"]["primitive"]
    placements = plan["anova_factors"]["placement"]
    main_contrasts = plan["main_contrasts"]
    commit_cost_baseline_variant = plan.get("commit_cost_baseline_variant")
    commit_cost_epsilon_pct = plan.get("commit_cost_equivalence_epsilon_pct")

    data_root = Path(args.data)
    df = load_by_rep(data_root, args.run_id)

    output: dict[str, Any] = {
        "run_id": args.run_id,
        "analysis_plan_frozen": True,
        "alpha": alpha,
        "epsilon_pct": epsilon_pct,
        "epsilon_reference_cell": reference_cell,
        "bootstrap_resamples": bootstrap_resamples,
        "bootstrap_seed": bootstrap_seed,
    }

    # Amandemen 1: independent of the E3 anova/contrasts below -- runs
    # (or reports unavailable) regardless of whether E3 data exists for
    # this RUN_ID, and vice versa.
    if commit_cost_baseline_variant is None or commit_cost_epsilon_pct is None:
        output["commit_cost_deltas"] = {
            "available": False,
            "reason_unavailable": "ANALYSIS_PLAN.md missing commit_cost_baseline_variant/commit_cost_equivalence_epsilon_pct (Amandemen 1 block not found)",
        }
    else:
        e1_records = load_e1_commit_records(data_root, args.run_id)
        output["commit_cost_deltas"] = run_commit_cost_deltas(
            e1_records, commit_cost_baseline_variant, commit_cost_epsilon_pct, alpha, bootstrap_resamples, bootstrap_seed
        )

    if df.empty:
        output["anova"] = {"t_value": anova_t_value, "available": False, "reason_unavailable": "e3_throughput_by_rep.csv is empty (no ok E3 repetitions)"}
        output["contrasts_by_t"] = {}
        write_output(data_root, args.run_id, output)
        return

    output["anova"] = run_anova(df, anova_t_value, primitives, placements, alpha)

    t_values = sorted(int(t) for t in df["t_value"].dropna().unique())
    contrasts_by_t: dict[str, list[dict[str, Any]]] = {}
    for t_value in t_values:
        results = []
        for c in main_contrasts:
            include_bootstrap = c["id"] == "placement_asc_inline_vs_asc_deferred"
            results.append(
                run_contrast(
                    df,
                    c["id"],
                    c["cell_a"],
                    c["cell_b"],
                    t_value,
                    alpha,
                    epsilon_pct,
                    reference_cell,
                    include_bootstrap,
                    bootstrap_resamples,
                    bootstrap_seed,
                )
            )
        holm_correct(results)
        contrasts_by_t[str(t_value)] = results

    output["contrasts_by_t"] = contrasts_by_t
    write_output(data_root, args.run_id, output)


def write_output(data_root: Path, run_id: str, output: dict[str, Any]) -> None:
    out_dir = data_root / "processed" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "stats.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"[stats] wrote {out_path}")


if __name__ == "__main__":
    main()
