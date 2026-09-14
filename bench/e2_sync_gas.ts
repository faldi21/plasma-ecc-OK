/**
 * E2 -- L1 sync overhead campaign (docs/TICKETS.md T6, T8-followup;
 * docs/EXPERIMENT_PRD.md §5). Measures gas for 9 functions, slot_init and
 * slot_update recorded separately, N repetitions each:
 *
 *   createDepositUtxo (L2), transferUtxoBatch (L2, B=100)
 *     -- measured against BOTH deployed systems (ASC's PlasmaChainUTXO.sol
 *     and Merkle's PlasmaChainUTXOMerkle.sol), cell_id-prefixed
 *     e2.asc.x / e2.merkle.x, since docs/EXPERIMENT_PRD.md §5's tab:op-gas
 *     Block A reports a real ASC/Merkle ratio for these two.
 *   deposit, depositETH, syncUtxoSpent, batchSyncUtxoSpent (n in
 *   {10,50,100}), updateUtxoBlock, registerExitUtxo, startExit,
 *   finalizeExit (all L1, against RootChainUTXO.sol -- ASC-only
 *     deployment, cell_id unprefixed: this repo has no Merkle-based
 *     RootChain contract to measure, a deliberate scope limit documented
 *     in docs/EXPERIMENT_PRD.md §5, not a gap left for this file to fill)
 *
 * slot_init vs slot_update (renamed from an earlier cold/warm draft, per
 * explicit correction: this is NOT EIP-2929 cold/warm access -- the access
 * list resets every transaction, so two back-to-back, separate
 * transactions are both "cold" in that sense and the label would be
 * meaningless). What is actually being measured is the SSTORE gas
 * schedule's zero->nonzero vs nonzero->nonzero distinction (§3.3): within
 * ONE snapshot (L2) or one unbroken sequence of real transactions (L1,
 * which has no snapshot/revert), the function is called twice, in two
 * SEPARATE transactions, on two distinct, freshly-prepared targets.
 * "slot_init" is the first call: every shared/global slot the function
 * touches (nonces, counters, array lengths) is written for the first time
 * this snapshot (a zero->nonzero SSTORE). "slot_update" is the second
 * call, in its own separate transaction: those same shared slots are now
 * already nonzero (a cheaper nonzero->nonzero SSTORE), even though the
 * per-target mapping slot (a fresh id either way) is a zero->nonzero write
 * on both calls. This is the working interpretation carried over from
 * this ticket's own design notes; it has not been separately confirmed
 * against a reviewer or a second source, so treat "slot_init"/
 * "slot_update" cell_id labels as this specific, stated definition.
 *
 * Two independent groups, run by two independent orchestrators (neither
 * reuses bench/harness/runner.ts's runCampaign(), which measures one
 * result per cell per repetition -- slot_init/slot_update pairs need two
 * measured calls, each its own transaction, sharing ONE unmeasured-setup +
 * snapshot, which runCampaign's per-cell snapshot/revert loop cannot
 * express):
 *
 *   runL2Campaign()  -- createDepositUtxo/transferUtxoBatch against local
 *     Anvil, snapshot/revert per repetition. ALWAYS runs, including under
 *     --dry-run.
 *   runL1Campaign()  -- the seven RootChainUTXO functions against real
 *     Sepolia (deposit/depositETH/syncUtxoSpent/batchSyncUtxoSpent/
 *     updateUtxoBlock/registerExitUtxo/startExit); finalizeExit is
 *     measured separately (see runFinalizeExitCampaign) since it needs
 *     time-travel past EXIT_PERIOD, which only a local, snapshot-capable
 *     chain can do. Both are skipped ENTIRELY under --dry-run -- no
 *     transaction is sent to Sepolia, and finalizeExit's local prep isn't
 *     run either, keeping --dry-run's behavior uniform across e1/e2 (the
 *     L1 half is skipped outright, not locally simulated as a stand-in).
 *
 * startExit's witness is forged off-chain (mirrors contracts/test/
 * ExploitA1_ExitGriefing.t.sol / ExploitA2_UnbackedExit.t.sol's approach,
 * and is the documented consequence of the accumulator's non-binding
 * property this whole paper is about -- not a shortcut invented for this
 * script): ECCAccumulator.verifyWithAccumulator checks only
 * `witness + utxoId*G == blockAccumulator`, so for ANY chosen
 * blockAccumulator, `witness = blockAccumulator - utxoId*G` verifies.
 * Cross-checked against Solidity's ECCMath point arithmetic the same way
 * e1_commit_cost.ts's scalarMulG was (see that file's docblock) before
 * being relied on here.
 *
 * Usage:
 *   npx tsx bench/e2_sync_gas.ts --dry-run --repetitions 1
 *   npx tsx bench/e2_sync_gas.ts --repetitions 30 --l1-repetitions 5
 */
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pkg from "elliptic";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { deriveAccounts, deriveElementIds, loadOperatorPrivateKey } from "./harness/accounts.js";
import { makeClients, loadAnvilConfig, snapshot, revert } from "./harness/anvil.js";
import { formatDurationMs, RecordWriter, computeEnvHash, type BenchRecord } from "./harness/record.js";
import { seedFor } from "./harness/rng.js";

const { ec: EC } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.paper1"), override: true });

// ---------------------------------------------------------------- CLI args

function parseArg(name: string, defaultValue: string): string {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultValue;
  return process.argv[idx + 1];
}

const DRY_RUN = process.argv.includes("--dry-run");
const REPETITIONS = parseInt(parseArg("--repetitions", DRY_RUN ? "1" : "30"), 10);
const L1_REPETITIONS = parseInt(parseArg("--l1-repetitions", "5"), 10);
const BASE_SEED = parseInt(parseArg("--seed", "50231145"), 10); // 0x2FE2E29 ("E2" leetish)

// ---------------------------------------------------------------- Constants

const BLOCK_GAS_LIMIT = 300_000_000n;
const BATCH_B = 100;
const BATCH_SYNC_SIZES = [10, 50, 100];
const SETUP_GAS = 250_000_000n;
const SETUP_CHUNK_SIZE = 100;

const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const N_CURVE = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const secp256k1 = new EC("secp256k1");

/**
 * Converts an `elliptic` curve point to {x,y} bigints, using (0,0) as the
 * point-at-infinity sentinel -- matches ECCMath.pointAdd's own convention
 * (contracts/src/libraries/ECCMath.sol lines 41-42, 54-56), where (0,0) is
 * never a valid non-infinity point on secp256k1 (0 doesn't satisfy
 * y^2 = x^3 + 7 mod P, so it can never collide with a real point). Without
 * this guard, `elliptic`'s internal identity representation (null
 * coordinates) makes .getX()/.getY() throw -- a real bug caught by a
 * TS-vs-Solidity parity check across 56 seeded/edge cases (3 of which hit
 * exactly this: utxoId=0, utxoId=N, and utxoId chosen so elemPoint==acc)
 * before this guard was added.
 */
function pointToXY(p: any): { x: bigint; y: bigint } {
  if (p.isInfinity()) return { x: 0n, y: 0n };
  return {
    x: BigInt("0x" + p.getX().toString(16).padStart(64, "0")),
    y: BigInt("0x" + p.getY().toString(16).padStart(64, "0")),
  };
}

/** The elliptic-curve point object for utxoId*G (elliptic's own
 * representation, infinity included) -- kept internal so callers that
 * need to .add()/.neg() it don't have to round-trip through (0,0). */
function elemPointRaw(utxoId: Hex) {
  const scalar = BigInt(utxoId) % N_CURVE;
  return secp256k1.g.mul(scalar.toString(16));
}

/** utxoId*G, mirroring ECCAccumulator.add's Point(GX,GY).scalarMul(uint256(element)). */
function elemPointG(utxoId: Hex): { x: bigint; y: bigint } {
  return pointToXY(elemPointRaw(utxoId));
}

/**
 * Forges a witness for `utxoId` against `blockAccumulator`, exploiting the
 * accumulator's documented non-binding property (witness = acc - id*G
 * always verifies, for ANY acc/id pair) -- see this file's docblock.
 */
function forgeWitness(blockAccumulator: { x: bigint; y: bigint }, utxoId: Hex): { x: bigint; y: bigint } {
  const acc =
    blockAccumulator.x === 0n && blockAccumulator.y === 0n
      ? secp256k1.curve.point(null, null)
      : secp256k1.curve.point(blockAccumulator.x.toString(16), blockAccumulator.y.toString(16));
  const elem = elemPointRaw(utxoId);
  const witness = acc.add(elem.neg());
  return pointToXY(witness);
}

// ---------------------------------------------------------------- Helpers

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

let recordSeq = 0;
function baseRecord(runId: string, envHash: string, cellId: string, repetition: number, seed: number, layer: "L1" | "L2"): BenchRecord {
  recordSeq++;
  return {
    run_id: runId,
    cell_id: cellId,
    repetition,
    seed,
    started_at: new Date().toISOString(),
    duration_ms: 0,
    layer,
    function: null,
    n_elements: null,
    gas_used: null,
    gas_limit: null,
    calldata_bytes: null,
    calldata_zero_bytes: null,
    calldata_nonzero_bytes: null,
    tx_count: null,
    tx_hash: null,
    block_number: null,
    ops_completed: null,
    ops_failed: null,
    ops_retried: null,
    latency_ms: null,
    status: "error",
    notes: null,
    env_hash: envHash,
    setup_tx_count: null,
    test_name: null,
    assert_result: null,
  };
}

// ---------------------------------------------------------------- L2: createDepositUtxo, transferUtxoBatch

/**
 * L2 operations that have a real counterpart in BOTH deployed systems
 * (ASC's PlasmaChainUTXO.sol and Merkle's PlasmaChainUTXOMerkle.sol --
 * identical createDepositUtxo(Batch)/transferUtxoBatch signatures, see
 * contracts/src/PlasmaChainUTXOMerkle.sol) are measured for both,
 * cell_id-prefixed by primitive (e2.asc.*, e2.merkle.*) so
 * make_tables.py's tab_op_gas.tex Block A can report a real ASC/Merkle
 * ratio column. L1 functions (runL1Campaign, below) stay unprefixed:
 * there is no Merkle-based RootChain contract anywhere in this repo to
 * measure, and that is documented as a deliberate scope limit (docs/
 * EXPERIMENT_PRD.md §5), not a gap this file is expected to fill.
 */
async function runL2Campaign(writer: RecordWriter, runId: string, envHash: string): Promise<void> {
  await runL2CampaignForContract(writer, runId, envHash, "asc", "PlasmaChainUTXO.sol/PlasmaChainUTXO.json");
  await runL2CampaignForContract(writer, runId, envHash, "merkle", "PlasmaChainUTXOMerkle.sol/PlasmaChainUTXOMerkle.json");
}

async function runL2CampaignForContract(
  writer: RecordWriter,
  runId: string,
  envHash: string,
  primitive: "asc" | "merkle",
  artifactPath: string
): Promise<void> {
  const anvilConfig = loadAnvilConfig();
  const operatorKey = loadOperatorPrivateKey();
  const { publicClient, operatorWalletClient, operatorAccount } = makeClients(anvilConfig, operatorKey);

  const { abi, bytecode } = loadArtifact(artifactPath);
  const deployHash = await operatorWalletClient.deployContract({
    abi,
    bytecode,
    account: operatorWalletClient.account!,
    chain: operatorWalletClient.chain,
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const address = deployReceipt.contractAddress as Address;

  const recipients = deriveAccounts(BASE_SEED, 4);

  for (let r = 0; r < REPETITIONS; r++) {
    const seed = seedFor(BASE_SEED, r);
    const snapId = await snapshot(publicClient);
    try {
      // ---- createDepositUtxo: slot_init then slot_update, two distinct fresh ids ----
      const depositIds = deriveElementIds(seed + 1, 2);
      for (let i = 0; i < 2; i++) {
        const state = i === 0 ? "slot_init" : "slot_update";
        const t0 = process.hrtime.bigint();
        const hash = await operatorWalletClient.writeContract({
          address,
          abi,
          functionName: "createDepositUtxo",
          args: [depositIds[i], operatorAccount.address, "0x000000000000000000000000000000000000dEaD", 1_000_000_000_000_000_000n],
          account: operatorWalletClient.account!,
          chain: operatorWalletClient.chain,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const t1 = process.hrtime.bigint();

        writer.write({
          ...baseRecord(runId, envHash, `e2.${primitive}.createDepositUtxo.${state}`, r, seed, "L2"),
          duration_ms: formatDurationMs(t0, t1),
          function: "createDepositUtxo",
          n_elements: 1,
          gas_used: Number(receipt.gasUsed),
          tx_count: 1,
          tx_hash: hash,
          block_number: Number(receipt.blockNumber),
          status: receipt.status === "success" ? "ok" : "error",
        });
      }

      // ---- transferUtxoBatch: slot_init then slot_update, B=100 inputs each ----
      // Unmeasured setup: fund 2*B deposit UTXOs owned by the operator (so
      // the operator can call transferUtxoBatch on them directly as
      // msg.sender == owner), via createDepositUtxoBatch chunked to
      // SETUP_CHUNK_SIZE (matching bench/e1_commit_cost.ts's and bench/
      // e3_throughput.ts's own setup convention) rather than one
      // createDepositUtxo transaction per id -- an earlier version of this
      // loop sent 200 individual transactions here, which was always slow
      // but became impractical once this ran twice per repetition (ASC
      // AND Merkle): caught when a --dry-run smoke test that used to take
      // well under a minute was still not done after 25+ minutes.
      const fundIds = deriveElementIds(seed + 2, 2 * BATCH_B);
      let setupTxCount = 0;
      for (const idChunk of chunk(fundIds, SETUP_CHUNK_SIZE)) {
        const users = idChunk.map(() => operatorAccount.address);
        const amounts = idChunk.map(() => 1_000_000_000_000_000_000n);
        const hash = await operatorWalletClient.writeContract({
          address,
          abi,
          functionName: "createDepositUtxoBatch",
          args: [idChunk, users, "0x000000000000000000000000000000000000dEaD", amounts],
          account: operatorWalletClient.account!,
          chain: operatorWalletClient.chain,
          gas: 250_000_000n,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error(`e2.${primitive}.transferUtxoBatch: setup chunk reverted unexpectedly (tx ${hash})`);
        }
        setupTxCount++;
      }

      const initInputs = fundIds.slice(0, BATCH_B);
      const updateInputs = fundIds.slice(BATCH_B, 2 * BATCH_B);
      for (const [state, inputs] of [
        ["slot_init", initInputs],
        ["slot_update", updateInputs],
      ] as const) {
        const outputOwners = inputs.map((_, i) => recipients[i % recipients.length].address);
        const outputAmounts = inputs.map(() => 1_000_000_000_000_000_000n);
        const outputCounts = inputs.map(() => 1);

        const t0 = process.hrtime.bigint();
        const hash = await operatorWalletClient.writeContract({
          address,
          abi,
          functionName: "transferUtxoBatch",
          args: [inputs, outputOwners, outputAmounts, outputCounts],
          account: operatorWalletClient.account!,
          chain: operatorWalletClient.chain,
          gas: 150_000_000n,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const t1 = process.hrtime.bigint();

        writer.write({
          ...baseRecord(runId, envHash, `e2.${primitive}.transferUtxoBatch.${state}`, r, seed, "L2"),
          duration_ms: formatDurationMs(t0, t1),
          function: "transferUtxoBatch",
          n_elements: BATCH_B,
          gas_used: Number(receipt.gasUsed),
          tx_count: 1,
          tx_hash: hash,
          block_number: Number(receipt.blockNumber),
          setup_tx_count: setupTxCount,
          status: receipt.status === "success" ? "ok" : "error",
          notes: "gas_used is for the whole B=100 batch tx; per-operation cost = gas_used / n_elements (computed downstream, not here).",
        });
      }
    } finally {
      await revert(publicClient, snapId);
    }
  }
}

// ---------------------------------------------------------------- L1: Sepolia (all but finalizeExit)

function loadSepoliaConfig(): { rpcUrl: string; pk: Hex } {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.L1_RPC;
  if (!rpcUrl) {
    throw new Error("SEPOLIA_RPC_URL (or L1_RPC) must be set in .env for L1 measurement (not needed under --dry-run)");
  }
  const pk = process.env.OPERATOR_PRIVATE_KEY as Hex | undefined;
  if (!pk) {
    throw new Error("OPERATOR_PRIVATE_KEY must be set in .env for L1 measurement (not needed under --dry-run)");
  }
  return { rpcUrl, pk };
}

function makeSepoliaClients(rpcUrl: string, pk: Hex) {
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 120_000 }) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl, { timeout: 120_000 }) });
  return { publicClient, walletClient, account };
}

async function runL1Campaign(writer: RecordWriter, runId: string, envHash: string): Promise<void> {
  const { rpcUrl, pk } = loadSepoliaConfig();
  const { publicClient, walletClient, account } = makeSepoliaClients(rpcUrl, pk);

  const rootChain = loadArtifact("RootChainUTXO.sol/RootChainUTXO.json");
  const token = loadArtifact("PlasmaToken.sol/PlasmaToken.json");

  console.log(`[e2_sync_gas] deploying RootChainUTXO + PlasmaToken to Sepolia (operator ${account.address})...`);
  const rootChainDeployHash = await walletClient.deployContract({
    abi: rootChain.abi,
    bytecode: rootChain.bytecode,
    args: [account.address],
    account,
    chain: sepolia,
  });
  const rootChainDeployReceipt = await publicClient.waitForTransactionReceipt({ hash: rootChainDeployHash });
  const rootChainAddress = rootChainDeployReceipt.contractAddress as Address;

  const tokenDeployHash = await walletClient.deployContract({
    abi: token.abi,
    bytecode: token.bytecode,
    args: ["E2 Bench Token", "E2BT", 1_000_000_000_000_000_000_000_000n],
    account,
    chain: sepolia,
  });
  const tokenDeployReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenDeployHash });
  const tokenAddress = tokenDeployReceipt.contractAddress as Address;

  const approveHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: token.abi,
    functionName: "approve",
    args: [rootChainAddress, 1_000_000_000_000_000_000_000_000n],
    account,
    chain: sepolia,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  // One arbitrary submitted "block" so registerExitUtxo/startExit have a
  // currentPlasmaBlock >= 1 and a blockAccumulator to forge witnesses
  // against. The point itself doesn't need to come from a real L2 block --
  // see this file's docblock on witness forging.
  const arbitraryBlockPoint = { x: GX, y: GY };
  const submitBlockHash = await walletClient.writeContract({
    address: rootChainAddress,
    abi: rootChain.abi,
    functionName: "submitBlock",
    args: [arbitraryBlockPoint, 0n],
    account,
    chain: sepolia,
  });
  await publicClient.waitForTransactionReceipt({ hash: submitBlockHash });
  console.log(`[e2_sync_gas] RootChainUTXO=${rootChainAddress} PlasmaToken=${tokenAddress}, one block submitted`);

  async function depositETHFresh(): Promise<Hex> {
    const hash = await walletClient.writeContract({
      address: rootChainAddress,
      abi: rootChain.abi,
      functionName: "depositETH",
      account,
      chain: sepolia,
      value: 1_000_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const log = receipt.logs.find((l) => l.address.toLowerCase() === rootChainAddress.toLowerCase());
    return log!.topics[1] as Hex; // DepositCreated(utxoId indexed, ...)
  }

  for (let r = 0; r < L1_REPETITIONS; r++) {
    const seed = seedFor(BASE_SEED, r);

    // ---- deposit (ERC20): slot_init then slot_update ----
    for (const state of ["slot_init", "slot_update"] as const) {
      const t0 = process.hrtime.bigint();
      const hash = await walletClient.writeContract({
        address: rootChainAddress,
        abi: rootChain.abi,
        functionName: "deposit",
        args: [tokenAddress, 1_000_000n],
        account,
        chain: sepolia,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const t1 = process.hrtime.bigint();
      writer.write({
        ...baseRecord(runId, envHash, `e2.deposit.${state}`, r, seed, "L1"),
        duration_ms: formatDurationMs(t0, t1),
        function: "deposit",
        n_elements: 1,
        gas_used: Number(receipt.gasUsed),
        tx_count: 1,
        tx_hash: hash,
        block_number: Number(receipt.blockNumber),
        status: receipt.status === "success" ? "ok" : "error",
      });
    }

    // ---- depositETH: slot_init then slot_update ----
    const depositEthIds: Hex[] = [];
    for (const state of ["slot_init", "slot_update"] as const) {
      const t0 = process.hrtime.bigint();
      const hash = await walletClient.writeContract({
        address: rootChainAddress,
        abi: rootChain.abi,
        functionName: "depositETH",
        account,
        chain: sepolia,
        value: 1_000_000n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const t1 = process.hrtime.bigint();
      const log = receipt.logs.find((l) => l.address.toLowerCase() === rootChainAddress.toLowerCase());
      depositEthIds.push(log!.topics[1] as Hex);
      writer.write({
        ...baseRecord(runId, envHash, `e2.depositETH.${state}`, r, seed, "L1"),
        duration_ms: formatDurationMs(t0, t1),
        function: "depositETH",
        n_elements: 1,
        gas_used: Number(receipt.gasUsed),
        tx_count: 1,
        tx_hash: hash,
        block_number: Number(receipt.blockNumber),
        status: receipt.status === "success" ? "ok" : "error",
      });
    }

    // ---- syncUtxoSpent: slot_init then slot_update, on the two depositETH utxos above ----
    for (let i = 0; i < 2; i++) {
      const state = i === 0 ? "slot_init" : "slot_update";
      const t0 = process.hrtime.bigint();
      const hash = await walletClient.writeContract({
        address: rootChainAddress,
        abi: rootChain.abi,
        functionName: "syncUtxoSpent",
        args: [depositEthIds[i], `0x${"11".repeat(32)}` as Hex],
        account,
        chain: sepolia,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const t1 = process.hrtime.bigint();
      writer.write({
        ...baseRecord(runId, envHash, `e2.syncUtxoSpent.${state}`, r, seed, "L1"),
        duration_ms: formatDurationMs(t0, t1),
        function: "syncUtxoSpent",
        n_elements: 1,
        gas_used: Number(receipt.gasUsed),
        tx_count: 1,
        tx_hash: hash,
        block_number: Number(receipt.blockNumber),
        status: receipt.status === "success" ? "ok" : "error",
      });
    }

    // ---- batchSyncUtxoSpent: for each n, slot_init then slot_update, 2n fresh unspent utxos ----
    for (const n of BATCH_SYNC_SIZES) {
      const ids: Hex[] = [];
      for (let i = 0; i < 2 * n; i++) ids.push(await depositETHFresh());
      const initIds = ids.slice(0, n);
      const updateIds = ids.slice(n, 2 * n);
      for (const [state, batchIds] of [
        ["slot_init", initIds],
        ["slot_update", updateIds],
      ] as const) {
        const txHashes = batchIds.map((_, i) => `0x${i.toString(16).padStart(2, "0").repeat(32)}`.slice(0, 66) as Hex);
        const t0 = process.hrtime.bigint();
        const hash = await walletClient.writeContract({
          address: rootChainAddress,
          abi: rootChain.abi,
          functionName: "batchSyncUtxoSpent",
          args: [batchIds, txHashes],
          account,
          chain: sepolia,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const t1 = process.hrtime.bigint();
        writer.write({
          ...baseRecord(runId, envHash, `e2.batchSyncUtxoSpent.n${n}.${state}`, r, seed, "L1"),
          duration_ms: formatDurationMs(t0, t1),
          function: "batchSyncUtxoSpent",
          n_elements: n,
          gas_used: Number(receipt.gasUsed),
          tx_count: 1,
          tx_hash: hash,
          block_number: Number(receipt.blockNumber),
          status: receipt.status === "success" ? "ok" : "error",
          notes: "gas_used is for the whole n-UTXO batch tx; per-UTXO cost = gas_used / n_elements (computed downstream, not here).",
        });
      }
    }

    // ---- updateUtxoBlock: slot_init then slot_update, two fresh createdInBlock==0 utxos ----
    const updateTargets = [await depositETHFresh(), await depositETHFresh()];
    for (let i = 0; i < 2; i++) {
      const state = i === 0 ? "slot_init" : "slot_update";
      const t0 = process.hrtime.bigint();
      const hash = await walletClient.writeContract({
        address: rootChainAddress,
        abi: rootChain.abi,
        functionName: "updateUtxoBlock",
        args: [updateTargets[i], 1n],
        account,
        chain: sepolia,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const t1 = process.hrtime.bigint();
      writer.write({
        ...baseRecord(runId, envHash, `e2.updateUtxoBlock.${state}`, r, seed, "L1"),
        duration_ms: formatDurationMs(t0, t1),
        function: "updateUtxoBlock",
        n_elements: 1,
        gas_used: Number(receipt.gasUsed),
        tx_count: 1,
        tx_hash: hash,
        block_number: Number(receipt.blockNumber),
        status: receipt.status === "success" ? "ok" : "error",
      });
    }

    // ---- registerExitUtxo: slot_init then slot_update, two fresh unregistered ids ----
    const exitIds = deriveElementIds(seed + 3, 2);
    for (let i = 0; i < 2; i++) {
      const state = i === 0 ? "slot_init" : "slot_update";
      const t0 = process.hrtime.bigint();
      const hash = await walletClient.writeContract({
        address: rootChainAddress,
        abi: rootChain.abi,
        functionName: "registerExitUtxo",
        args: [exitIds[i], account.address, "0x000000000000000000000000000000000000dEaD", 1_000_000n, 1n],
        account,
        chain: sepolia,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const t1 = process.hrtime.bigint();
      writer.write({
        ...baseRecord(runId, envHash, `e2.registerExitUtxo.${state}`, r, seed, "L1"),
        duration_ms: formatDurationMs(t0, t1),
        function: "registerExitUtxo",
        n_elements: 1,
        gas_used: Number(receipt.gasUsed),
        tx_count: 1,
        tx_hash: hash,
        block_number: Number(receipt.blockNumber),
        status: receipt.status === "success" ? "ok" : "error",
      });
    }

    // ---- startExit: slot_init then slot_update, two fresh unspent/unexited utxos ----
    const startExitTargets = [await depositETHFresh(), await depositETHFresh()];
    for (let i = 0; i < 2; i++) {
      const state = i === 0 ? "slot_init" : "slot_update";
      const witness = forgeWitness(arbitraryBlockPoint, startExitTargets[i]);
      const t0 = process.hrtime.bigint();
      const hash = await walletClient.writeContract({
        address: rootChainAddress,
        abi: rootChain.abi,
        functionName: "startExit",
        args: [startExitTargets[i], 1n, witness],
        account,
        chain: sepolia,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const t1 = process.hrtime.bigint();
      writer.write({
        ...baseRecord(runId, envHash, `e2.startExit.${state}`, r, seed, "L1"),
        duration_ms: formatDurationMs(t0, t1),
        function: "startExit",
        n_elements: 1,
        gas_used: Number(receipt.gasUsed),
        calldata_bytes: null,
        tx_count: 1,
        tx_hash: hash,
        block_number: Number(receipt.blockNumber),
        status: receipt.status === "success" ? "ok" : "error",
        notes: "witness is a forged (non-cryptographic) 64-byte point -- see file docblock.",
      });
    }
  }
}

// ---------------------------------------------------------------- L1: finalizeExit (local, time-travel)

/**
 * finalizeExit needs block.timestamp >= exitTime (exitTime = startExit's
 * timestamp + EXIT_PERIOD, 7 minutes on this deployment). Real Sepolia has
 * no time-travel, so per §5's own allowance ("pakai evm_increaseTime di
 * fork lokal Sepolia kalau perlu") this is measured on a FRESH RootChainUTXO
 * deployed to the local, snapshot-capable Anvil instead -- gas cost only
 * depends on this contract's own state, not on real Sepolia history, so a
 * literal Sepolia fork buys nothing a plain local deployment doesn't.
 */
async function runFinalizeExitCampaign(writer: RecordWriter, runId: string, envHash: string): Promise<void> {
  const anvilConfig = loadAnvilConfig();
  const operatorKey = loadOperatorPrivateKey();
  const { publicClient, operatorWalletClient, operatorAccount } = makeClients(anvilConfig, operatorKey);

  const rootChain = loadArtifact("RootChainUTXO.sol/RootChainUTXO.json");
  const deployHash = await operatorWalletClient.deployContract({
    abi: rootChain.abi,
    bytecode: rootChain.bytecode,
    args: [operatorAccount.address],
    account: operatorWalletClient.account!,
    chain: operatorWalletClient.chain,
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const address = deployReceipt.contractAddress as Address;

  const exitPeriod = (await publicClient.readContract({
    address,
    abi: rootChain.abi,
    functionName: "EXIT_PERIOD",
  })) as bigint;

  const arbitraryBlockPoint = { x: GX, y: GY };

  for (let r = 0; r < L1_REPETITIONS; r++) {
    const seed = seedFor(BASE_SEED, r);
    const snapId = await snapshot(publicClient);
    try {
      const submitBlockHash = await operatorWalletClient.writeContract({
        address,
        abi: rootChain.abi,
        functionName: "submitBlock",
        args: [arbitraryBlockPoint, 0n],
        account: operatorWalletClient.account!,
        chain: operatorWalletClient.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: submitBlockHash });

      const exitIdsForRep: Hex[] = [];
      for (let i = 0; i < 2; i++) {
        const depositHash = await operatorWalletClient.writeContract({
          address,
          abi: rootChain.abi,
          functionName: "depositETH",
          account: operatorWalletClient.account!,
          chain: operatorWalletClient.chain,
          value: 1_000_000n,
        });
        const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
        const depositLog = depositReceipt.logs.find((l) => l.address.toLowerCase() === address.toLowerCase());
        const utxoId = depositLog!.topics[1] as Hex;

        const witness = forgeWitness(arbitraryBlockPoint, utxoId);
        const startExitHash = await operatorWalletClient.writeContract({
          address,
          abi: rootChain.abi,
          functionName: "startExit",
          args: [utxoId, 1n, witness],
          account: operatorWalletClient.account!,
          chain: operatorWalletClient.chain,
        });
        const startExitReceipt = await publicClient.waitForTransactionReceipt({ hash: startExitHash });
        const exitLog = startExitReceipt.logs.find((l) => l.address.toLowerCase() === address.toLowerCase());
        exitIdsForRep.push(exitLog!.topics[1] as Hex);
      }

      await publicClient.request({ method: "evm_increaseTime" as any, params: [Number(exitPeriod) + 1] as any });
      await publicClient.request({ method: "evm_mine" as any, params: [] as any });

      for (let i = 0; i < 2; i++) {
        const state = i === 0 ? "slot_init" : "slot_update";
        const t0 = process.hrtime.bigint();
        const hash = await operatorWalletClient.writeContract({
          address,
          abi: rootChain.abi,
          functionName: "finalizeExit",
          args: [exitIdsForRep[i]],
          account: operatorWalletClient.account!,
          chain: operatorWalletClient.chain,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const t1 = process.hrtime.bigint();
        writer.write({
          ...baseRecord(runId, envHash, `e2.finalizeExit.${state}`, r, seed, "L1"),
          duration_ms: formatDurationMs(t0, t1),
          function: "finalizeExit",
          n_elements: 1,
          gas_used: Number(receipt.gasUsed),
          tx_count: 1,
          tx_hash: hash,
          block_number: Number(receipt.blockNumber),
          status: receipt.status === "success" ? "ok" : "error",
          notes: `measured on local Anvil (not Sepolia) for time-travel past EXIT_PERIOD=${exitPeriod}s -- see file docblock.`,
        });
      }
    } finally {
      await revert(publicClient, snapId);
    }
  }
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const runId =
    process.env.RUN_ID || `e2_${DRY_RUN ? "dryrun_" : ""}${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const dataRoot = path.join(REPO_ROOT, process.env.DATA_ROOT || "data");
  const outputFilename = "e2_sync_gas.jsonl";

  mkdirSync(path.join(dataRoot, "raw"), { recursive: true });
  const writer = new RecordWriter(dataRoot, runId, outputFilename);
  const envHash = computeEnvHash(REPO_ROOT);

  console.log(
    `[e2_sync_gas] run_id=${runId} dry_run=${DRY_RUN} repetitions=${REPETITIONS} l1_repetitions=${L1_REPETITIONS}`
  );

  await runL2Campaign(writer, runId, envHash);
  console.log(`[e2_sync_gas] L2 campaign (createDepositUtxo, transferUtxoBatch) complete.`);

  if (DRY_RUN) {
    console.log("[e2_sync_gas] --dry-run: skipping all L1 functions entirely (deposit..finalizeExit), no L1 transaction sent.");
  } else {
    await runL1Campaign(writer, runId, envHash);
    console.log(`[e2_sync_gas] L1 Sepolia campaign complete.`);
    await runFinalizeExitCampaign(writer, runId, envHash);
    console.log(`[e2_sync_gas] finalizeExit (local, time-traveled) campaign complete.`);
  }

  console.log(`[e2_sync_gas] output -> ${writer.path}`);
  const lines = readFileSync(writer.path, "utf8").trim().split("\n");
  console.log(`\n[e2_sync_gas] sample JSONL lines (${lines.length} total):`);
  for (const line of lines.slice(0, 6)) console.log(line);
}

// Guarded so this file is importable (e.g. by a forgeWitness parity check)
// without triggering a full campaign run as a side effect of import.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { forgeWitness, elemPointG, GX, GY, N_CURVE };
