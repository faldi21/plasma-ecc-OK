/**
 * T5 smoke test (docs/TICKETS.md), E3-scoped per the harness fix: proves
 * the harness (bench/harness) works end to end with ONE example
 * throughput cell -- "e3.deferred.T500". This measures ONLY the window
 * from the first batch transaction sent to the last batch receipt
 * received; createBlock() is NEVER called inside that window (or at all,
 * in this script) -- committing pending UTXOs is an e1.x / sys.x concern
 * (see bench/smoke_e1_commit.ts), not e3.x's. "Deferred" here just means
 * this measures PlasmaChainUTXO's existing architecture, where
 * createDepositUtxoBatch/transferUtxo never touch the accumulator --
 * that deferral is already true by construction, not something this
 * script needs to arrange.
 *
 * This is NOT the real E3 campaign (T7's job: full 2x2 factorial design,
 * K>=20 accounts, N>=30 repetitions) -- it exists only to prove the
 * harness mechanics work before T6/T7 build on top of them.
 *
 * Run: npx tsx bench/smoke_e3_deferred.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { Address, Hex } from "viem";
import { runCampaign, type Cell, type CellContext, type CellResult } from "./harness/runner.js";
import { deriveElementIds, loadOperatorPrivateKey } from "./harness/accounts.js";
import { makeClients, loadAnvilConfig, setBalance } from "./harness/anvil.js";
import { formatDurationMs } from "./harness/record.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// .env (private keys, gitignored) first, then .env.paper1 (campaign
// config: DATA_ROOT, ANVIL_PORT, N_REPS, ...) layered on top -- matching
// how Makefile.paper1's `include .env.paper1; export` composes with the
// project's main .env.
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.paper1"), override: true });

function loadArtifact(relPath: string): { abi: any; bytecode: Hex } {
  const p = path.join(REPO_ROOT, "out", relPath);
  const json = JSON.parse(readFileSync(p, "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object as Hex };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const T = 500; // total sub-operations for this smoke cell
const BATCH_SIZE = 100; // -> 5 batches

async function throughputCell(ctx: CellContext, totalOps: number, batchSize: number): Promise<CellResult> {
  const { abi, bytecode } = loadArtifact("PlasmaChainUTXO.sol/PlasmaChainUTXO.json");

  // ---- Setup (NOT part of the measured window): deploy a fresh contract. ----
  const deployHash = await ctx.walletClient.deployContract({
    abi,
    bytecode,
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
  });
  const deployReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: deployHash });
  const contractAddress = deployReceipt.contractAddress as Address;

  const ids = deriveElementIds(ctx.seed, totalOps);
  const users = ids.map((_, i) => `0x${(0x1000 + i).toString(16).padStart(40, "0")}` as Address);
  const amounts = ids.map(() => 1_000_000_000_000_000_000n); // 1 ether each
  const token = "0x000000000000000000000000000000000000dEaD" as Address;

  const idBatches = chunk(ids, batchSize);
  const userBatches = chunk(users, batchSize);
  const amountBatches = chunk(amounts, batchSize);

  // ---- Measured window starts: first batch transaction sent. ----
  const windowStart = process.hrtime.bigint();
  const latencyMs: number[] = [];
  let opsCompleted = 0;
  let opsFailed = 0;
  const opsRetried = 0; // this smoke cell does not retry; real E3 (T7) will

  for (let b = 0; b < idBatches.length; b++) {
    const batchStart = process.hrtime.bigint();
    try {
      const hash = await ctx.walletClient.writeContract({
        address: contractAddress,
        abi,
        functionName: "createDepositUtxoBatch",
        args: [idBatches[b], userBatches[b], token, amountBatches[b]],
        account: ctx.walletClient.account!,
        chain: ctx.walletClient.chain,
        gas: 50_000_000n, // createDepositUtxoBatch never touches the accumulator -- cheap regardless of batch size
      });
      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
      const batchEnd = process.hrtime.bigint();
      latencyMs.push(formatDurationMs(batchStart, batchEnd));

      if (receipt.status === "success") {
        opsCompleted += idBatches[b].length;
      } else {
        opsFailed += idBatches[b].length;
      }
    } catch {
      const batchEnd = process.hrtime.bigint();
      latencyMs.push(formatDurationMs(batchStart, batchEnd));
      opsFailed += idBatches[b].length;
    }
  }
  // ---- Measured window ends: last batch receipt received. No createBlock() call anywhere in this script. ----
  const windowEnd = process.hrtime.bigint();

  return {
    duration_ms: formatDurationMs(windowStart, windowEnd), // overrides harness's own timing, which would otherwise include contract deployment above
    // gas_used / function / n_elements intentionally left undefined ->
    // null in the record: this is an E3 throughput cell, not a gas
    // measurement. See bench/smoke_e1_commit.ts for the E1/sys.* cell
    // that measures createBlock() gas.
    ops_completed: opsCompleted,
    ops_failed: opsFailed,
    ops_retried: opsRetried,
    latency_ms: latencyMs,
    status: opsFailed === 0 ? "ok" : "error",
  };
}

const cells: Cell[] = [
  {
    id: `e3.deferred.T${T}`,
    layer: "L2",
    fn: (ctx) => throughputCell(ctx, T, BATCH_SIZE),
  },
];

async function main() {
  const runId = `${new Date()
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 14)}-smoke-e3`;
  const dataRoot = process.env.DATA_ROOT || "data";

  console.log(`[smoke-e3] RUN_ID=${runId} T=${T} batchSize=${BATCH_SIZE} cells=${cells.map((c) => c.id).join(",")}`);

  // Fund the operator BEFORE the campaign loop starts (outside any
  // snapshot), so it survives every per-cell evm_revert.
  const anvilConfig = loadAnvilConfig();
  const { publicClient, operatorAccount } = makeClients(anvilConfig, loadOperatorPrivateKey());
  await setBalance(publicClient, operatorAccount.address, "0x21e19e0c9bab2400000" as Hex); // 10,000 ETH
  console.log(`[smoke-e3] funded operator ${operatorAccount.address}`);

  const writer = await runCampaign({
    runId,
    dataRoot,
    outputFilename: "smoke_e3_deferred.jsonl",
    repoRoot: REPO_ROOT,
    cells,
    repetitions: 1,
    warmupBatches: 1,
    baseSeed: 0xdeadbeef,
  });

  console.log(`[smoke-e3] wrote records to ${writer.path}`);
  const content = readFileSync(writer.path, "utf8");
  console.log("[smoke-e3] file contents:");
  console.log(content);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
