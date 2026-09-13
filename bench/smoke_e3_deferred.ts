/**
 * T5 smoke test (docs/TICKETS.md): proves the harness (bench/harness/*)
 * works end to end with ONE example cell -- "e3.deferred.T500", i.e. 500
 * sub-operations queued and committed in a single deferred createBlock()
 * call, matching the deferred-commitment semantics this whole project is
 * built around. This is NOT the real E3 campaign (T7's job, with its full
 * 2x2 factorial design, K>=20 accounts, N>=30 repetitions) -- it exists
 * only to prove the harness mechanics (snapshot/warm-up/run/record/revert,
 * per-repetition seeded shuffle, append-only RUN_ID directories) function
 * correctly before T6/T7 build on top of them.
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

const T = 500; // sub-operations for this smoke cell, per the ticket's instruction

async function deferredCell(ctx: CellContext, n: number): Promise<CellResult> {
  const { abi, bytecode } = loadArtifact("PlasmaChainUTXO.sol/PlasmaChainUTXO.json");

  // Deploy a fresh PlasmaChainUTXO (isolated by the harness's snapshot
  // taken before this cell runs).
  const deployHash = await ctx.walletClient.deployContract({
    abi,
    bytecode,
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
  });
  const deployReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: deployHash });
  const contractAddress = deployReceipt.contractAddress as Address;

  // Populate n pending UTXOs deterministically from this run's seed --
  // "deferred" means these are only queued, no per-element commit.
  const ids = deriveElementIds(ctx.seed, n);
  const users = ids.map((_, i) => `0x${(0x1000 + i).toString(16).padStart(40, "0")}` as Address);
  const amounts = ids.map(() => 1_000_000_000_000_000_000n); // 1 ether each
  const token = "0x000000000000000000000000000000000000dEaD" as Address;

  const fundHash = await ctx.walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName: "createDepositUtxoBatch",
    args: [ids, users, token, amounts],
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
    gas: 900_000_000n,
  });
  const fundReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: fundHash });
  if (fundReceipt.status !== "success") {
    throw new Error(`createDepositUtxoBatch reverted (tx ${fundHash}) -- pendingUtxos was never populated`);
  }

  // Single deferred commit: one createBlock() call for all n queued
  // elements, not one per element. n=500 with the current (pre-ASC1SM)
  // PlasmaChainUTXO.sol calls accumulator.add() -> one scalarMul per
  // element, so this needs a large gas allowance (Anvil started with
  // --disable-block-gas-limit for exactly this reason).
  const commitHash = await ctx.walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName: "createBlock",
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
    gas: 900_000_000n,
  });
  const commitReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: commitHash });

  return {
    function: "createBlock",
    n_elements: n,
    gas_used: Number(commitReceipt.gasUsed),
    gas_limit: 900_000_000,
    tx_count: 1,
    tx_hash: commitHash,
    block_number: Number(commitReceipt.blockNumber),
    ops_completed: n,
    ops_failed: 0,
    ops_retried: 0,
    status: commitReceipt.status === "success" ? "ok" : "error",
  };
}

const cells: Cell[] = [
  {
    id: `e3.deferred.T${T}`,
    layer: "L2",
    fn: (ctx) => deferredCell(ctx, T),
  },
];

async function main() {
  const runId = `${new Date()
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 14)}-smoke`;
  const dataRoot = process.env.DATA_ROOT || "data";

  console.log(`[smoke] RUN_ID=${runId} T=${T} cells=${cells.map((c) => c.id).join(",")}`);

  // Fund the operator BEFORE the campaign loop starts (outside any
  // snapshot), so it survives every per-cell evm_revert -- a fresh Anvil
  // instance starts every account at zero balance unless it's one of
  // Anvil's own funded default accounts.
  const anvilConfig = loadAnvilConfig();
  const { publicClient, operatorAccount } = makeClients(anvilConfig, loadOperatorPrivateKey());
  await setBalance(publicClient, operatorAccount.address, "0x21e19e0c9bab2400000" as Hex); // 10,000 ETH
  console.log(`[smoke] funded operator ${operatorAccount.address}`);

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

  console.log(`[smoke] wrote records to ${writer.path}`);
  const content = readFileSync(writer.path, "utf8");
  console.log("[smoke] file contents:");
  console.log(content);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
