/**
 * Phase-level wall-clock instrumentation for the campaign harness --
 * DIAGNOSTIC ONLY. Every number this module produces goes to stdout and
 * NEVER into data/raw/<RUN_ID>/*.jsonl: a BenchRecord's duration_ms is a
 * measurement of the object under study (the commit transaction), while
 * these are measurements of the harness itself (how long deploy/setup/
 * estimateGas/receipt-waiting take). Mixing the two into one file would
 * make the frozen record schema mean two different things.
 *
 * Off by default; enable with --phase-timing or PHASE_TIMING=1. When off,
 * phase() is a straight pass-through with no timing and no output, so a
 * real campaign's behaviour and stdout are byte-identical to before this
 * module existed.
 *
 * Context vs. phase: the runner sets a CONTEXT ("warmup[0]", "measured",
 * ...) around each execution of a cell function, and the cell function
 * marks PHASES ("deploy", "setup", "estimate_gas", ...) inside it. They
 * combine into one key ("warmup[0].estimate_gas"), which is what makes it
 * possible to see that e.g. eth_estimateGas is paid once per warm-up
 * batch AND again for the measured run, rather than once per cell.
 */
const ENABLED = process.argv.includes("--phase-timing") || process.env.PHASE_TIMING === "1";

interface PhaseTotal {
  ms: number;
  calls: number;
}

let currentCell = "(no cell)";
let currentContext = "";
let cellTotals = new Map<string, PhaseTotal>();
const runTotals = new Map<string, PhaseTotal>();
let cellStartNs = 0n;

export const PHASE_TIMING_ENABLED = ENABLED;

/** Starts a fresh per-cell accounting block. */
export function beginPhaseCell(cellId: string): void {
  if (!ENABLED) return;
  currentCell = cellId;
  currentContext = "";
  cellTotals = new Map();
  cellStartNs = process.hrtime.bigint();
}

/** Labels which execution of the cell function the following phases belong to. */
export function setPhaseContext(context: string): void {
  if (!ENABLED) return;
  currentContext = context;
}

function record(key: string, ms: number): void {
  for (const totals of [cellTotals, runTotals]) {
    const prev = totals.get(key) ?? { ms: 0, calls: 0 };
    prev.ms += ms;
    prev.calls += 1;
    totals.set(key, prev);
  }
}

/** Times one phase. Pass-through (zero overhead, no output) when disabled. */
export async function phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!ENABLED) return fn();
  const key = currentContext ? `${currentContext}.${name}` : name;
  const t0 = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    record(key, Number(process.hrtime.bigint() - t0) / 1e6);
  }
}

function formatTable(title: string, totals: Map<string, PhaseTotal>, wallMs: number): string {
  const rows = [...totals.entries()].sort((a, b) => b[1].ms - a[1].ms);
  const lines = [
    `[phase] ${title}  wall=${wallMs.toFixed(1)}ms`,
    `[phase]   ${"phase".padEnd(34)} ${"calls".padStart(6)} ${"total_ms".padStart(12)} ${"pct_wall".padStart(9)}`,
  ];
  for (const [key, v] of rows) {
    const pct = wallMs > 0 ? (v.ms / wallMs) * 100 : 0;
    lines.push(`[phase]   ${key.padEnd(34)} ${String(v.calls).padStart(6)} ${v.ms.toFixed(1).padStart(12)} ${pct.toFixed(1).padStart(8)}%`);
  }
  return lines.join("\n");
}

/** Prints the phase breakdown for the cell most recently begun. */
export function endPhaseCell(): void {
  if (!ENABLED) return;
  const wallMs = Number(process.hrtime.bigint() - cellStartNs) / 1e6;
  console.log(formatTable(`cell=${currentCell}`, cellTotals, wallMs));
}

/** Prints the whole-run phase breakdown (call once, after the campaign). */
export function printPhaseGrandTotal(totalWallMs: number): void {
  if (!ENABLED) return;
  console.log(formatTable("GRAND TOTAL (all cells)", runTotals, totalWallMs));
}
