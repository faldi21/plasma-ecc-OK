/**
 * Record schema + append-only JSONL writer, per docs/EXPERIMENT_PRD.md
 * §3.2 exactly (fields not relevant to a given run are `null`, not
 * omitted). env_hash covers tool versions and config so a later reader
 * can tell whether two runs are truly comparable.
 */
import { existsSync, mkdirSync, openSync, closeSync, statSync, writeSync, fsyncSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";

/**
 * docs/EXPERIMENT_PRD.md §3.2's record schema, extended additively (all
 * original fields unchanged; new fields are optional/nullable so any
 * reader written against the original schema still works):
 *
 *   - status gains "exceeds_block_gas_limit": the expected, DATA outcome
 *     (not a bug) when a cell_id under e1.* or sys.* needs more gas than
 *     the node's configured block gas limit -- see anvil.ts/runner.ts.
 *     "pass"/"fail" cover E4 exploit/property tests, whose pass/fail
 *     comes from Foundry test assertions, not a transaction receipt.
 *   - setup_tx_count: for e1.x / sys.x cells, how many transactions the
 *     (unmeasured) setup phase took -- relevant because setup may need to
 *     be split into multiple transactions to fit under the same block gas
 *     limit that bounds the measured createBlock() call itself.
 *   - status gains "aborted_memory_guard": E3 stopped ITSELF because the
 *     Anvil process crossed E3_ANVIL_MAX_RSS_MB, rather than waiting to be
 *     killed by the kernel (ANALYSIS_PLAN.md Amandemen 2). It marks a run
 *     that was deliberately NOT measured -- never a measurement.
 *   - test_name / assert_result: for e4.x cells, which Foundry test
 *     function this record is for, and whether its assertions passed --
 *     redundant with cell_id/status by convention, but explicit so a
 *     reader doesn't have to know that convention to find them.
 */
export interface BenchRecord {
  run_id: string;
  cell_id: string;
  repetition: number;
  seed: number;
  started_at: string; // ISO 8601
  duration_ms: number; // 3 decimals, not rounded
  layer: "L1" | "L2" | null;
  function: string | null;
  n_elements: number | null;
  gas_used: number | null;
  gas_limit: number | null;
  calldata_bytes: number | null;
  calldata_zero_bytes: number | null;
  calldata_nonzero_bytes: number | null;
  tx_count: number | null;
  tx_hash: string | null;
  block_number: number | null;
  ops_completed: number | null;
  ops_failed: number | null;
  ops_retried: number | null;
  latency_ms: number[] | null;
  status: "ok" | "error" | "exceeds_block_gas_limit" | "timeout" | "aborted_memory_guard" | "pass" | "fail";
  notes: string | null;
  env_hash: string;
  setup_tx_count?: number | null;
  test_name?: string | null;
  assert_result?: "pass" | "fail" | null;
  /**
   * The node's own configured block gas limit (Anvil's --gas-limit, e.g.
   * 300_000_000 -- roughly 10x mainnet's, deliberately raised so the gas
   * curve can still be MEASURED past the real limit). Never used to decide
   * mainnet feasibility -- see exceeds_mainnet_block_limit for that
   * (pre-freeze harness fix, CACAT 2: the two were conflated before).
   */
  block_gas_limit?: number | null;
  /**
   * gas_used > 36_000_000 (a real Ethereum mainnet block's approximate gas
   * limit), computed from the measured receipt, independent of whatever
   * gas_limit Anvil was configured with. This is the field any "does this
   * fit in a real block" claim must cite.
   */
  exceeds_mainnet_block_limit?: boolean | null;
}

function sh(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function sha256File(p: string): string | null {
  if (!existsSync(p)) return null;
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/**
 * Hashes together tool versions and config so any two records can be
 * checked for comparability (§2's environment spec, condensed into one
 * fingerprint). Cached per-process since none of these change mid-run.
 */
let cachedEnvHash: string | null = null;
export function computeEnvHash(repoRoot: string): string {
  if (cachedEnvHash) return cachedEnvHash;

  const parts = [
    sh("forge --version") ?? "forge:unknown",
    sh("anvil --version") ?? "anvil:unknown",
    process.version, // node
    sha256File(path.join(repoRoot, "foundry.toml")) ?? "foundry.toml:missing",
    sha256File(path.join(repoRoot, "package-lock.json")) ?? "package-lock.json:missing",
  ];

  const digest = createHash("sha256").update(parts.join("\n")).digest("hex");
  cachedEnvHash = `sha256:${digest}`;
  return cachedEnvHash;
}

/**
 * Append-only JSONL writer scoped to one RUN_ID. The RUN_ID directory
 * itself is expected to pre-exist -- `make freeze` creates it for
 * manifest.json, and one RUN_ID must hold e1..e4's results together, so
 * the directory existing is never an error (docs/TICKETS.md pre-freeze
 * harness fix: the earlier directory-level check was wrong and made the
 * campaign unrunnable). What IS refused is overwriting an experiment's own
 * result file: if data/raw/<RUN_ID>/<filename> already exists and is
 * non-empty, construction refuses to proceed (manifest.json is a sibling
 * file, never counted as a result). The check-then-create is done with a
 * single exclusive-create syscall ('ax'), not a separate existsSync() then
 * write, so two processes racing to create the same new file can't both
 * succeed -- one gets EEXIST atomically, not a torn/overwritten file.
 *
 * Also enforces L2 tx_hash uniqueness across the whole RUN_ID (pre-freeze
 * harness fix, CACAT 1): under snapshot/revert isolation, two genuinely
 * different, independently-executed transactions can end up byte-identical
 * once signed (same nonce, same calldata, same fee) and therefore hash the
 * same -- that is a real provenance hazard, not something to allow
 * quietly. The seen-hash set is seeded from every sibling *.jsonl already
 * in this RUN_ID's directory at construction time (one RUN_ID holds
 * e1..e4 together), then grows as this writer's own write() calls happen.
 *
 * Durability: every write() is a writeSync() followed by an fsyncSync() on
 * this file's own descriptor, so a finished record is on disk before the
 * next one is even attempted. Nothing is batched or held until the end of
 * a phase -- a campaign killed (or a machine lost) mid-phase keeps every
 * record that had already completed.
 *
 * Resume ({ resume: true }): instead of refusing a non-empty result file,
 * read it, remember which (cell_id, repetition) pairs it already contains,
 * and open for APPEND. Old records are never rewritten, reordered or
 * overwritten -- callers ask has() and skip the work that is already done.
 */
export interface RecordWriterOptions {
  /** Append to (and skip past) an existing result file instead of refusing it. */
  resume?: boolean;
}

/** Identity of one unit of work: a cell measured at one repetition. */
function completionKey(cellId: string, repetition: number): string {
  return `${cellId}|${repetition}`;
}

export class RecordWriter {
  private readonly filePath: string;
  private readonly fd: number;
  private readonly seenL2TxHashes = new Set<string>();
  private readonly completed = new Set<string>();
  /** How many records the file already had when this writer opened it (resume only). */
  readonly resumedRecordCount: number;

  constructor(dataRoot: string, runId: string, filename: string, options: RecordWriterOptions = {}) {
    const dir = path.join(dataRoot, "raw", runId);
    mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, filename);

    let ownRecordCount = 0;
    for (const sibling of readdirSync(dir)) {
      if (!sibling.endsWith(".jsonl")) continue;
      const isOwnFile = path.join(dir, sibling) === this.filePath;
      for (const line of readFileSync(path.join(dir, sibling), "utf8").split("\n")) {
        if (!line) continue;
        let rec: Partial<BenchRecord>;
        try {
          rec = JSON.parse(line);
        } catch {
          continue; // tolerate a torn last line from a crashed prior process
        }
        if (rec.layer === "L2" && rec.tx_hash) this.seenL2TxHashes.add(rec.tx_hash);
        if (isOwnFile && rec.cell_id !== undefined && rec.repetition !== undefined) {
          this.completed.add(completionKey(rec.cell_id, rec.repetition));
          ownRecordCount += 1;
        }
      }
    }
    this.resumedRecordCount = options.resume ? ownRecordCount : 0;

    try {
      this.fd = openSync(this.filePath, "ax");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      if (statSync(this.filePath).size > 0 && !options.resume) {
        const experiment = filename.replace(/\.jsonl$/, "");
        console.error(
          `FATAL: hasil ${experiment} untuk RUN_ID ini sudah ada; jangan timpa (${this.filePath}). ` +
            `Pakai --resume kalau memang mau melanjutkan run yang terputus.`
        );
        process.exit(1);
      }

      // Either an empty leftover file (a prior process created it then
      // crashed before its first write), or --resume on a real one. Both
      // open for append; neither rewrites a byte that is already there.
      this.fd = openSync(this.filePath, "a");
    }
  }

  /** True if this (cell_id, repetition) already has a record in the file (resume). */
  has(cellId: string, repetition: number): boolean {
    return this.completed.has(completionKey(cellId, repetition));
  }

  write(record: BenchRecord): void {
    if (record.layer === "L2" && record.tx_hash) {
      if (this.seenL2TxHashes.has(record.tx_hash)) {
        console.error(
          `FATAL: tx_hash ${record.tx_hash} sudah dipakai record L2 lain dalam RUN_ID ini ` +
            `(cell_id=${record.cell_id}, repetition=${record.repetition}). Kalau ini memang satu ` +
            `transaksi dengan beberapa pengukuran yang sah, itu butuh mekanisme eksplisit -- bukan ` +
            `diizinkan diam-diam di sini.`
        );
        process.exit(1);
      }
      this.seenL2TxHashes.add(record.tx_hash);
    }
    writeSync(this.fd, JSON.stringify(record) + "\n", null, "utf8");
    // Durable before the next record is even attempted: a crash, a kill,
    // or a lost machine keeps everything finished up to this point.
    fsyncSync(this.fd);
    this.completed.add(completionKey(record.cell_id, record.repetition));
  }

  close(): void {
    closeSync(this.fd);
  }

  get path(): string {
    return this.filePath;
  }
}

/** Formats a duration in milliseconds to exactly 3 decimals (not rounded away). */
export function formatDurationMs(startNs: bigint, endNs: bigint): number {
  const ns = endNs - startNs;
  return Number(ns) / 1e6;
}
