/**
 * Campaign orchestrator, per docs/EXPERIMENT_PRD.md §3.3-3.4: for each
 * repetition, shuffle all cells with a recorded per-repetition seed, and
 * for each cell: snapshot -> warm-up (discarded) -> measured run -> record
 * -> revert. This is the shared engine E1/E2/E3 (T6/T7) will call into --
 * T5's own job is only to prove the engine itself works (smoke test).
 */
import { makeClients, loadAnvilConfig, snapshot, revert } from "./anvil.js";
import { loadOperatorPrivateKey } from "./accounts.js";
import { seedFor, shuffle } from "./rng.js";
import { RecordWriter, computeEnvHash, formatDurationMs, type BenchRecord } from "./record.js";
import type { Hex } from "viem";

export interface CellContext {
  publicClient: ReturnType<typeof makeClients>["publicClient"];
  walletClient: ReturnType<typeof makeClients>["operatorWalletClient"];
  operatorAddress: `0x${string}`;
  seed: number;
}

export interface CellResult {
  function?: string;
  n_elements?: number;
  gas_used?: number;
  gas_limit?: number;
  calldata_bytes?: number;
  calldata_zero_bytes?: number;
  calldata_nonzero_bytes?: number;
  tx_count?: number;
  tx_hash?: string;
  block_number?: number;
  ops_completed?: number;
  ops_failed?: number;
  ops_retried?: number;
  latency_ms?: number[];
  status: "ok" | "error";
  notes?: string;
}

export interface Cell {
  id: string; // cell_id, e.g. "e1.asc_1sm.n100" or "e3.deferred.T500"
  layer: "L1" | "L2" | null;
  fn: (ctx: CellContext) => Promise<CellResult>;
}

export interface CampaignConfig {
  runId: string;
  dataRoot: string;
  outputFilename: string;
  repoRoot: string;
  cells: Cell[];
  repetitions: number;
  warmupBatches: number;
  baseSeed: number;
}

export async function runCampaign(config: CampaignConfig): Promise<RecordWriter> {
  const anvilConfig = loadAnvilConfig();
  const operatorKey = loadOperatorPrivateKey();
  const { publicClient, operatorWalletClient, operatorAccount } = makeClients(anvilConfig, operatorKey);

  const writer = new RecordWriter(config.dataRoot, config.runId, config.outputFilename);
  const envHash = computeEnvHash(config.repoRoot);

  const ctxBase = {
    publicClient,
    walletClient: operatorWalletClient,
    operatorAddress: operatorAccount.address,
  };

  for (let r = 0; r < config.repetitions; r++) {
    const repSeed = seedFor(config.baseSeed, r);
    const orderedCells = shuffle(config.cells, repSeed);

    for (const cell of orderedCells) {
      const snapId = await snapshot(publicClient);
      try {
        // Warm-up: run W times, results discarded (not recorded), so the
        // measured run below starts from realistic warm storage-access
        // state rather than a cold, unrepresentative first-touch cost.
        for (let w = 0; w < config.warmupBatches; w++) {
          await cell.fn({ ...ctxBase, seed: repSeed + 1_000_000 + w });
        }

        const startedAt = new Date().toISOString();
        const t0 = process.hrtime.bigint();
        const result = await cell.fn({ ...ctxBase, seed: repSeed });
        const t1 = process.hrtime.bigint();

        const record: BenchRecord = {
          run_id: config.runId,
          cell_id: cell.id,
          repetition: r,
          seed: repSeed,
          started_at: startedAt,
          duration_ms: formatDurationMs(t0, t1),
          layer: cell.layer,
          function: result.function ?? null,
          n_elements: result.n_elements ?? null,
          gas_used: result.gas_used ?? null,
          gas_limit: result.gas_limit ?? null,
          calldata_bytes: result.calldata_bytes ?? null,
          calldata_zero_bytes: result.calldata_zero_bytes ?? null,
          calldata_nonzero_bytes: result.calldata_nonzero_bytes ?? null,
          tx_count: result.tx_count ?? null,
          tx_hash: result.tx_hash ?? null,
          block_number: result.block_number ?? null,
          ops_completed: result.ops_completed ?? null,
          ops_failed: result.ops_failed ?? null,
          ops_retried: result.ops_retried ?? null,
          latency_ms: result.latency_ms ?? null,
          status: result.status,
          notes: result.notes ?? null,
          env_hash: envHash,
        };
        writer.write(record);
      } finally {
        await revert(publicClient, snapId);
      }
    }
  }

  return writer;
}

export type { Hex };
