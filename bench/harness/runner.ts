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
import { beginPhaseCell, endPhaseCell, phase, printPhaseGrandTotal, setPhaseContext } from "./phase_timer.js";
import type { Hex } from "viem";

export interface CellContext {
  publicClient: ReturnType<typeof makeClients>["publicClient"];
  walletClient: ReturnType<typeof makeClients>["operatorWalletClient"];
  operatorAddress: `0x${string}`;
  seed: number;
}

export interface CellResult {
  /**
   * Overrides the record's duration_ms with a window the cell measured
   * itself, instead of the harness's own t0/t1 around the whole cell.fn()
   * call. Needed whenever a cell does unmeasured setup (contract deploy,
   * funding) before or after the specific window that should be timed --
   * e.g. E3's "first batch sent to last batch receipt" window must not
   * include contract deployment, and an E1/sys cell's createBlock() gas
   * measurement must not include its setup transactions either. Cells
   * with no such distinction (nothing to exclude) can omit this and let
   * the harness's own timing apply.
   */
  duration_ms?: number;
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
  status: "ok" | "error" | "exceeds_block_gas_limit" | "timeout" | "pass" | "fail";
  notes?: string;
  setup_tx_count?: number;
  test_name?: string;
  assert_result?: "pass" | "fail";
  /** The node's own configured block gas limit -- see BenchRecord's docblock (record.ts). */
  block_gas_limit?: number;
  /** gas_used > 36_000_000 -- see BenchRecord's docblock (record.ts). */
  exceeds_mainnet_block_limit?: boolean;
}

export interface Cell {
  // cell_id naming convention (not enforced by the harness, but relied on
  // by scripts/verify_paper1.sh and the E3/E1 separation this file's
  // callers must respect): "e1.<variant>.n<N>" / "sys.<system>.n<N>" for
  // cells that measure createBlock() gas cost (bounded by the node's real
  // block gas limit -- see the "exceeds_block_gas_limit" status);
  // "e3.<placement>.T<T>" for throughput cells, which measure ONLY the
  // batch-submission-to-receipt window and must never include a
  // createBlock() call in what they time; "e4.<Contract>.<test>" for
  // exploit/property test results (see bench/e4_exploits.ts).
  id: string;
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

  const campaignStartNs = process.hrtime.bigint();

  for (let r = 0; r < config.repetitions; r++) {
    const repSeed = seedFor(config.baseSeed, r);
    const orderedCells = shuffle(config.cells, repSeed);

    for (const cell of orderedCells) {
      beginPhaseCell(`${cell.id} rep=${r}`);
      const snapId = await phase("snapshot", () => snapshot(publicClient));
      try {
        // Warm-up: run W times, results discarded (not recorded), so the
        // measured run below starts from realistic warm storage-access
        // state rather than a cold, unrepresentative first-touch cost.
        for (let w = 0; w < config.warmupBatches; w++) {
          setPhaseContext(`warmup[${w}]`);
          await phase("cell_fn", () => cell.fn({ ...ctxBase, seed: repSeed + 1_000_000 + w }));
        }

        setPhaseContext("measured");
        const startedAt = new Date().toISOString();
        const t0 = process.hrtime.bigint();
        const result = await phase("cell_fn", () => cell.fn({ ...ctxBase, seed: repSeed }));
        const t1 = process.hrtime.bigint();

        const record: BenchRecord = {
          run_id: config.runId,
          cell_id: cell.id,
          repetition: r,
          seed: repSeed,
          started_at: startedAt,
          duration_ms: result.duration_ms ?? formatDurationMs(t0, t1),
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
          setup_tx_count: result.setup_tx_count ?? null,
          test_name: result.test_name ?? null,
          assert_result: result.assert_result ?? null,
          block_gas_limit: result.block_gas_limit ?? null,
          exceeds_mainnet_block_limit: result.exceeds_mainnet_block_limit ?? null,
        };
        await phase("write_record", async () => writer.write(record));
      } finally {
        setPhaseContext("");
        await phase("revert", () => revert(publicClient, snapId));
        endPhaseCell();
      }
    }
  }

  printPhaseGrandTotal(Number(process.hrtime.bigint() - campaignStartNs) / 1e6);
  return writer;
}

export type { Hex };
