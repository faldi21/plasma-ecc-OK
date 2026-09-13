/**
 * Record schema + append-only JSONL writer, per docs/EXPERIMENT_PRD.md
 * §3.2 exactly (fields not relevant to a given run are `null`, not
 * omitted). env_hash covers tool versions and config so a later reader
 * can tell whether two runs are truly comparable.
 */
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";

/** docs/EXPERIMENT_PRD.md §3.2's record schema, verbatim. */
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
  status: "ok" | "error";
  notes: string | null;
  env_hash: string;
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

export class RunIdAlreadyExistsError extends Error {
  constructor(dir: string) {
    super(`RUN_ID directory already exists, refusing to write into it: ${dir}`);
    this.name = "RunIdAlreadyExistsError";
  }
}

/**
 * Append-only JSONL writer scoped to one RUN_ID. Refuses to initialize
 * against a RUN_ID whose directory already exists (docs/TICKETS.md T5
 * acceptance criteria: "runner menolak menimpa RUN_ID yang sudah ada") --
 * this check happens once, at construction, not per write() call, so a
 * single campaign process can append many records across its run.
 */
export class RecordWriter {
  private readonly filePath: string;

  constructor(dataRoot: string, runId: string, filename: string) {
    const dir = path.join(dataRoot, "raw", runId);
    if (existsSync(dir)) {
      throw new RunIdAlreadyExistsError(dir);
    }
    mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, filename);
  }

  write(record: BenchRecord): void {
    appendFileSync(this.filePath, JSON.stringify(record) + "\n", "utf8");
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
