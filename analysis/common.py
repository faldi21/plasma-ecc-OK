"""
Shared helpers for analysis/{aggregate,stats,make_tables,make_figures}.py
(docs/TICKETS.md T8). Not one of the four scripts the ticket names, but a
small internal module to avoid duplicating descriptive-stats math and
JSONL/CSV I/O across them -- make_tables.py and make_figures.py still only
ever READ the CSV/stats.json this produces (see their own docblocks), so
this module does not violate "tidak ada perhitungan di dalam make_tables/
make_figures".

Status values a BenchRecord can carry (bench/harness/record.ts):
"ok" | "error" | "exceeds_block_gas_limit" | "pass" | "fail" | "batch_timeout"
(batch_timeout is E3-specific, noted in a record's `notes` field rather
than its own `status`, since one E3 record aggregates many batches -- see
NON_OK_E3_NOTE_MARKER below). "ok" and "pass" are the two "this run
succeeded" values; everything else is a failure that must be counted, not
dropped (CLAUDE.md IRON RULE 2 and 7).
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

OK_STATUSES = {"ok", "pass"}

# E3's per-run record reports a single status ("ok"/"error") for the WHOLE
# run even when only some batches timed out (bench/e3_throughput.ts writes
# status="error" whenever ops_failed > 0, and separately notes which
# batches hit BATCH_TIMEOUT_MS). This marker lets aggregate.py distinguish
# "some batches timed out" from a generic failure when building the
# status breakdown, purely for more informative reporting -- it does not
# change n_failed/n_ok counting, which is still driven by `status` alone.
BATCH_TIMEOUT_NOTE_MARKER = "batch_timeout"

# ---------------------------------------------------------------- venue
#
# ANALYSIS_PLAN.md Amandemen 4. A record's `layer` field says which layer
# of the PROTOCOL an operation belongs to ("L1" = a RootChainUTXO.sol
# operation). It does NOT say where the measurement was actually executed.
# Ten e2.finalizeExit records carry layer="L1" but were measured on a
# local Anvil devnet, because finalizeExit requires evm_increaseTime past
# EXIT_PERIOD, which no public network can do.
#
# `venue` is that missing distinction, derived here and never written back
# to data/raw/ (IRON RULE 2). The rule, in full:
#
#   1. A record with block_number >= SEPOLIA_MIN_BLOCK was measured on
#      Sepolia; anything else was measured locally.
#   2. Corroboration is REQUIRED, not optional: a record classified
#      "local" that carries a tx_hash must also say so in `notes`, and a
#      record classified "sepolia" must not claim to be local. If the two
#      signals disagree, venue_of() raises instead of guessing.
#
# Why the threshold is unambiguous rather than a tuning knob: Sepolia was
# at block ~11,716,000 when this campaign ran (2026-09-16) and a fresh
# Anvil devnet starts at block 0. The campaign's own numbers are blocks
# 15..11,718,467, with nothing at all between 1,170 and 11,716,074 -- the
# two populations are separated by four orders of magnitude, so no record
# sits anywhere near the threshold.
SEPOLIA_MIN_BLOCK = 1_000_000

VENUE_SEPOLIA = "sepolia"
VENUE_LOCAL = "local"

# Substrings that count as a record admitting, in its own `notes`, that it
# was measured off the public network.
_LOCAL_NOTE_MARKERS = ("local anvil", "local devnet", "not sepolia")


class VenueConflict(Exception):
    """block_number and notes disagree about where a record ran. Never
    resolved by preferring one signal: the dataset is frozen, so a
    conflict means the RULE is wrong and must be re-derived, not that a
    record should be quietly reclassified."""


def venue_of(record: dict[str, Any]) -> str:
    """Where this record was actually measured: VENUE_SEPOLIA or
    VENUE_LOCAL. Records with no block_number at all (E4 Foundry test
    executions) are local: forge runs them in its own in-process EVM."""
    block_number = record.get("block_number")
    notes = (record.get("notes") or "").lower()
    claims_local = any(marker in notes for marker in _LOCAL_NOTE_MARKERS)

    if block_number is None:
        venue = VENUE_LOCAL
    elif block_number >= SEPOLIA_MIN_BLOCK:
        venue = VENUE_SEPOLIA
    else:
        venue = VENUE_LOCAL

    if venue == VENUE_SEPOLIA and claims_local:
        raise VenueConflict(
            f"{record.get('cell_id')} rep{record.get('repetition')}: block_number="
            f"{block_number} says Sepolia but notes says local -- {notes!r}"
        )
    # The note is only DEMANDED where running locally is surprising: a
    # layer="L1" operation, which the reader would otherwise assume ran on
    # the public network. L2 records are local by construction -- the
    # entire evaluated L2 is an Anvil devnet (docs/EXPERIMENT_PRD.md
    # SS2.1) -- so they need no per-record excuse.
    if (
        venue == VENUE_LOCAL
        and record.get("layer") == "L1"
        and record.get("tx_hash")
        and not claims_local
    ):
        raise VenueConflict(
            f"{record.get('cell_id')} rep{record.get('repetition')}: block_number="
            f"{block_number} says local and the record has a tx_hash, but notes "
            f"does not explain why this L1 operation ran off-network -- {notes!r}"
        )
    return venue


def cell_venue(records: list[dict[str, Any]]) -> str:
    """The venue of a whole cell. Raises if one cell mixes venues: that
    would make its mean a mean over two different chains, which no table
    should ever print as a single number."""
    venues = sorted({venue_of(r) for r in records})
    if len(venues) > 1:
        raise VenueConflict(
            f"{records[0].get('cell_id')}: satu sel bercampur venue {venues} -- "
            "rata-ratanya akan menggabungkan dua chain berbeda"
        )
    return venues[0]


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def find_run_jsonl_files(data_root: Path, run_id: str) -> list[Path]:
    run_dir = data_root / "raw" / run_id
    if not run_dir.is_dir():
        raise FileNotFoundError(f"data/raw/{run_id} does not exist under {data_root}")
    return sorted(run_dir.glob("*.jsonl"))


@dataclass
class Describe:
    """Descriptive stats for one numeric sample. n=0 means the field was
    never present/non-null in the group; every stat is None in that case
    -- callers must render \\fillin{} for that, never a fabricated 0 or NaN
    dressed up as a real number (CLAUDE.md IRON RULE 1)."""

    n: int
    mean: float | None = None
    sd: float | None = None
    median: float | None = None
    p95: float | None = None
    vmin: float | None = None
    vmax: float | None = None
    ci95_low: float | None = None
    ci95_high: float | None = None

    def as_row(self, prefix: str) -> dict[str, Any]:
        return {
            f"{prefix}_n": self.n,
            f"{prefix}_mean": self.mean,
            f"{prefix}_sd": self.sd,
            f"{prefix}_median": self.median,
            f"{prefix}_p95": self.p95,
            f"{prefix}_min": self.vmin,
            f"{prefix}_max": self.vmax,
            f"{prefix}_ci95_low": self.ci95_low,
            f"{prefix}_ci95_high": self.ci95_high,
        }


def describe(values: Iterable[float], alpha: float = 0.05) -> Describe:
    """mean/SD/median/p95/min/max/N/CI95%(t-Student) -- docs/EXPERIMENT_PRD.md
    §7.1 / ANALYSIS_PLAN.md §1. Requires scipy only for the t critical
    value; everything else is plain math so this stays cheap to import
    from aggregate.py (which otherwise has no scipy dependency)."""
    vals = [float(v) for v in values if v is not None and not (isinstance(v, float) and math.isnan(v))]
    n = len(vals)
    if n == 0:
        return Describe(n=0)

    mean = sum(vals) / n
    if n > 1:
        variance = sum((v - mean) ** 2 for v in vals) / (n - 1)
        sd = math.sqrt(variance)
    else:
        sd = None

    sorted_vals = sorted(vals)
    median = _percentile(sorted_vals, 50)
    p95 = _percentile(sorted_vals, 95)
    vmin = sorted_vals[0]
    vmax = sorted_vals[-1]

    ci_low = ci_high = None
    if n > 1 and sd is not None:
        from scipy import stats as scipy_stats  # local import: keep aggregate.py's common path light

        se = sd / math.sqrt(n)
        tcrit = scipy_stats.t.ppf(1 - alpha / 2, df=n - 1)
        ci_low = mean - tcrit * se
        ci_high = mean + tcrit * se

    return Describe(n=n, mean=mean, sd=sd, median=median, p95=p95, vmin=vmin, vmax=vmax, ci95_low=ci_low, ci95_high=ci_high)


def _percentile(sorted_vals: list[float], pct: float) -> float:
    """Linear-interpolation percentile (numpy's default 'linear' method),
    implemented without numpy so aggregate.py can run with just scipy."""
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * (pct / 100)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    d0 = sorted_vals[int(f)] * (c - k)
    d1 = sorted_vals[int(c)] * (k - f)
    return d0 + d1


def status_breakdown(records: list[dict[str, Any]]) -> str:
    """'error:2;exceeds_block_gas_limit:1' style summary of every non-ok
    status in the group, sorted for determinism -- never silently
    collapsed into a single failure count (CLAUDE.md IRON RULE 7)."""
    counts: dict[str, int] = {}
    for r in records:
        status = r.get("status")
        if status in OK_STATUSES:
            continue
        key = status
        if status == "error" and r.get("notes") and BATCH_TIMEOUT_NOTE_MARKER in str(r["notes"]):
            key = "error(batch_timeout)"
        counts[key] = counts.get(key, 0) + 1
    return ";".join(f"{k}:{v}" for k, v in sorted(counts.items()))
