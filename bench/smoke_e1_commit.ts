/**
 * T5 harness-fix smoke test: proves the E1/sys.x commit-cost path works
 * correctly under Anvil's REAL block gas limit (300,000,000 -- no
 * --disable-block-gas-limit; docs/TICKETS.md T5 harness fix #1). Two
 * cells:
 *   - sys.plasma_eccmath.n10  -- small enough to fit, measures real gas.
 *   - sys.plasma_eccmath.n500 -- deliberately too large for the current
 *     (pre-ASC1SM) PlasmaChainUTXO.sol, which still calls
 *     accumulator.add() per element (O(n) scalarMul). This is NOT routed
 *     around by raising the limit -- the cell estimates gas first via
 *     eth_estimateGas, and if that alone reports more gas than the
 *     configured block limit, records status="exceeds_block_gas_limit"
 *     (with n and the cell id in `notes`) and returns WITHOUT ever
 *     sending the doomed transaction. This is a measured RESULT, not a
 *     harness failure.
 *
 * Setup (funding via createDepositUtxoBatch) is split into multiple
 * transactions sized to fit under the same block gas limit, and the
 * transaction count is recorded via setup_tx_count -- setup itself is
 * NOT part of the measured createBlock() window (duration_ms/gas_used
 * only cover the createBlock() call).
 *
 * Run: npx tsx bench/smoke_e1_commit.ts
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

dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.paper1"), override: true });

// Must match how Anvil was actually launched for this run (recorded in
// the freeze manifest too, see scripts/freeze_paper1.sh) -- this is the
// boundary condition being measured, not a harness parameter to tune per
// cell.
const BLOCK_GAS_LIMIT = 300_000_000n;
const SETUP_CHUNK_SIZE = 100; // per-transaction funding chunk, small enough to always fit

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

async function commitCostCell(ctx: CellContext, n: number): Promise<CellResult> {
  const { abi, bytecode } = loadArtifact("PlasmaChainUTXO.sol/PlasmaChainUTXO.json");

  // ---- Setup (unmeasured): deploy + fund, split into chunks that each fit. ----
  const deployHash = await ctx.walletClient.deployContract({
    abi,
    bytecode,
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
  });
  const deployReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: deployHash });
  const contractAddress = deployReceipt.contractAddress as Address;

  const ids = deriveElementIds(ctx.seed, n);
  const users = ids.map((_, i) => `0x${(0x1000 + i).toString(16).padStart(40, "0")}` as Address);
  const amounts = ids.map(() => 1_000_000_000_000_000_000n);
  const token = "0x000000000000000000000000000000000000dEaD" as Address;

  const idChunks = chunk(ids, SETUP_CHUNK_SIZE);
  const userChunks = chunk(users, SETUP_CHUNK_SIZE);
  const amountChunks = chunk(amounts, SETUP_CHUNK_SIZE);
  let setupTxCount = 0;
  for (let i = 0; i < idChunks.length; i++) {
    const hash = await ctx.walletClient.writeContract({
      address: contractAddress,
      abi,
      functionName: "createDepositUtxoBatch",
      args: [idChunks[i], userChunks[i], token, amountChunks[i]],
      account: ctx.walletClient.account!,
      chain: ctx.walletClient.chain,
      gas: 250_000_000n, // one setup chunk must itself fit under the block limit
    });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`setup chunk ${i} (createDepositUtxoBatch) reverted unexpectedly (tx ${hash})`);
    }
    setupTxCount++;
  }

  // ---- Measured window: createBlock() only. First, estimate gas WITHOUT
  // sending a transaction -- if the estimate alone exceeds the real block
  // gas limit, this IS the result (exceeds_block_gas_limit), not
  // something to work around by raising the limit. ----
  let estimatedGas: bigint;
  try {
    estimatedGas = await ctx.publicClient.estimateContractGas({
      address: contractAddress,
      abi,
      functionName: "createBlock",
      account: ctx.walletClient.account!,
    });
  } catch (err) {
    // Anvil's eth_estimateGas itself refuses when the requirement exceeds
    // the block gas limit -- that refusal IS the measurement.
    return {
      status: "exceeds_block_gas_limit",
      n_elements: n,
      function: "createBlock",
      setup_tx_count: setupTxCount,
      notes: `cell=sys.plasma_eccmath n=${n}: eth_estimateGas itself refused (exceeds configured block gas limit ${BLOCK_GAS_LIMIT}); no transaction was sent. Raw: ${String(
        (err as Error).message
      ).slice(0, 200)}`,
      duration_ms: 0,
    };
  }

  if (estimatedGas > BLOCK_GAS_LIMIT) {
    return {
      status: "exceeds_block_gas_limit",
      n_elements: n,
      function: "createBlock",
      setup_tx_count: setupTxCount,
      notes: `cell=sys.plasma_eccmath n=${n}: estimated gas ${estimatedGas} > block gas limit ${BLOCK_GAS_LIMIT}; no transaction was sent.`,
      duration_ms: 0,
    };
  }

  // Fits: send it for real and measure the receipt's actual gas.
  const t0 = process.hrtime.bigint();
  const commitHash = await ctx.walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName: "createBlock",
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
    gas: BLOCK_GAS_LIMIT,
  });
  const commitReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: commitHash });
  const t1 = process.hrtime.bigint();

  return {
    duration_ms: formatDurationMs(t0, t1), // excludes setup above
    function: "createBlock",
    n_elements: n,
    gas_used: Number(commitReceipt.gasUsed),
    gas_limit: Number(BLOCK_GAS_LIMIT),
    tx_count: 1,
    tx_hash: commitHash,
    block_number: Number(commitReceipt.blockNumber),
    setup_tx_count: setupTxCount,
    status: commitReceipt.status === "success" ? "ok" : "error",
  };
}

const cells: Cell[] = [
  { id: "sys.plasma_eccmath.n10", layer: "L2", fn: (ctx) => commitCostCell(ctx, 10) },
  { id: "sys.plasma_eccmath.n500", layer: "L2", fn: (ctx) => commitCostCell(ctx, 500) },
];

async function main() {
  const runId = `${new Date()
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 14)}-smoke-e1`;
  const dataRoot = process.env.DATA_ROOT || "data";

  console.log(`[smoke-e1] RUN_ID=${runId} cells=${cells.map((c) => c.id).join(",")}`);

  const anvilConfig = loadAnvilConfig();
  const { publicClient, operatorAccount } = makeClients(anvilConfig, loadOperatorPrivateKey());
  await setBalance(publicClient, operatorAccount.address, "0x21e19e0c9bab2400000" as Hex);
  console.log(`[smoke-e1] funded operator ${operatorAccount.address}`);

  const writer = await runCampaign({
    runId,
    dataRoot,
    outputFilename: "smoke_e1_commit.jsonl",
    repoRoot: REPO_ROOT,
    cells,
    repetitions: 1,
    warmupBatches: 0, // warm-up would itself hit the same exceeds_block_gas_limit path for n=500; skip for this smoke run
    baseSeed: 0xc0ffee,
  });

  console.log(`[smoke-e1] wrote records to ${writer.path}`);
  const content = readFileSync(writer.path, "utf8");
  console.log("[smoke-e1] file contents:");
  console.log(content);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
