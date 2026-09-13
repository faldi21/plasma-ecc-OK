/**
 * E1 -- commit cost campaign (docs/TICKETS.md T6; docs/EXPERIMENT_PRD.md
 * §4.3, §4.6). Two groups of cells that are NEVER compared cross-group
 * (§4.6's table is explicit about this):
 *
 *   bench.commit_<variant>.n<N>  -- seven minimal benchmark contracts
 *     (contracts/src/commit/), isolating the digest primitive itself.
 *     n in {10, 100, 1000}.
 *   sys.plasma_v0.n<N> / sys.plasma_eccmath.n<N> -- the full deployed L2
 *     system, pre- and post-ECCMath-extraction (contracts/src/legacy/
 *     PlasmaChainUTXOV0.sol vs contracts/src/PlasmaChainUTXO.sol).
 *     n in {10, 25, 50, 100, 200}.
 *
 * For every cell: setup (deploy + funding) is split into transactions of
 * at most 100 elements each, sized to fit under the block gas limit on
 * its own; the number of setup transactions is recorded via
 * setup_tx_count and is NOT part of the measured window. createBlock()'s
 * gas is estimated first via eth_estimateGas, WITHOUT sending a
 * transaction; if the estimate itself is refused (exceeds the node's
 * configured block gas limit), the cell records
 * status="exceeds_block_gas_limit" and moves on -- the limit is never
 * raised to force a cell through.
 *
 * L1 anchoring (n=100 only, via RootChainBench.sol on Sepolia) is
 * entirely skipped under --dry-run. Its repetition count is configured
 * separately from L2's (--l1-repetitions, default 5), per §4.3's
 * "N_L1 = 5 while L2 uses N >= 30" allowance.
 *
 * Usage:
 *   npx tsx bench/e1_commit_cost.ts --dry-run --repetitions 1
 *   npx tsx bench/e1_commit_cost.ts --repetitions 30 --l1-repetitions 5
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
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
import { runCampaign, type Cell, type CellContext, type CellResult } from "./harness/runner.js";
import { deriveElementIds, loadOperatorPrivateKey } from "./harness/accounts.js";
import { makeClients, loadAnvilConfig, setBalance } from "./harness/anvil.js";
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
const BASE_SEED = parseInt(parseArg("--seed", "14757395"), 10); // 0xE1E1E1

// ---------------------------------------------------------------- Constants

const BLOCK_GAS_LIMIT = 300_000_000n;
const SETUP_CHUNK_SIZE = 100;
const L1_TX_GAS_LIMIT = 300_000n;
const L1_ANCHOR_N = 100;
const ROOT_CHAIN_BENCH_ARTIFACT = "RootChainBench.sol/RootChainBench.json";
const RECEIPTS_DIR_NAME = "receipts";

const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const N_CURVE = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const secp256k1 = new EC("secp256k1");

/** Mirrors ECCMath.scalarMul(GX, GY, s) -- cross-checked against Solidity
 * directly before this file was written (see commit message). */
function scalarMulG(s: bigint): { x: bigint; y: bigint } {
  const point = secp256k1.g.mul(s.toString(16));
  return {
    x: BigInt("0x" + point.getX().toString(16).padStart(64, "0")),
    y: BigInt("0x" + point.getY().toString(16).padStart(64, "0")),
  };
}

const COMMIT_VARIANTS: { id: string; contract: string }[] = [
  { id: "baseline", contract: "CommitBaseline" },
  { id: "asc_naive", contract: "CommitASCNaive" },
  { id: "asc_1sm", contract: "CommitASC1SM" },
  { id: "asc_ecrecover", contract: "CommitASCEcrecover" },
  { id: "scalar", contract: "CommitScalar" },
  { id: "keccak", contract: "CommitKeccak" },
  { id: "merkle", contract: "CommitMerkle" },
];
const BENCH_N_VALUES = [10, 100, 1000];
const SYS_N_VALUES = [10, 25, 50, 100, 200];

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

/** Counts zero vs nonzero bytes in a 0x-prefixed hex calldata string. */
function calldataByteStats(dataHex: Hex): { total: number; zero: number; nonzero: number } {
  const bytes = dataHex.slice(2);
  let zero = 0;
  let nonzero = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const byte = bytes.slice(i, i + 2);
    if (byte === "00") zero++;
    else nonzero++;
  }
  return { total: zero + nonzero, zero, nonzero };
}

/**
 * CommitKeccak.sol requires ids to be submitted in strictly increasing
 * order (its docblock: canonical digest regardless of off-chain collection
 * order); deriveElementIds' keccak256-derived ids are not naturally sorted,
 * so createBlock() would revert on out-of-order input. Sorting ascending
 * before submission fixes that without changing gas cost -- the contract's
 * per-element work (compare, hash, store) is identical regardless of which
 * order a fixed set of ids arrives in. The other six variants are all
 * order-independent (commutative addmod or commutative Merkle hashing --
 * see each contract's docblock), so this is scoped to keccak only.
 */
function idsForVariant(variantId: string, ids: readonly Hex[]): Hex[] {
  if (variantId !== "keccak") return [...ids];
  return [...ids].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
}

// ---------------------------------------------------------------- bench.commit_* cells

/** Deploys the given commit-variant contract, funds it via addPendingBatch
 * (chunked to fit under the block gas limit), estimates createBlock()'s
 * gas WITHOUT sending it, and either records exceeds_block_gas_limit or
 * sends it for real and measures the receipt. */
async function benchCommitCell(ctx: CellContext, variantId: string, contractName: string, n: number): Promise<CellResult> {
  const { abi, bytecode } = loadArtifact(`${contractName}.sol/${contractName}.json`);

  const deployHash = await ctx.walletClient.deployContract({
    abi,
    bytecode,
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
  });
  const deployReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: deployHash });
  const address = deployReceipt.contractAddress as Address;

  const ids = idsForVariant(variantId, deriveElementIds(ctx.seed, n));
  const idChunks = chunk(ids, SETUP_CHUNK_SIZE);
  let setupTxCount = 0;
  for (const idsChunk of idChunks) {
    const hash = await ctx.walletClient.writeContract({
      address,
      abi,
      functionName: "addPendingBatch",
      args: [idsChunk],
      account: ctx.walletClient.account!,
      chain: ctx.walletClient.chain,
      gas: 250_000_000n,
    });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`bench.commit_${variantId}.n${n}: setup chunk reverted unexpectedly (tx ${hash})`);
    }
    setupTxCount++;
  }

  // CommitASCEcrecover needs the operator's off-chain-computed claimed
  // point (s*G) as createBlock's arguments; every other variant takes no
  // arguments.
  const isEcrecover = variantId === "asc_ecrecover";
  let claimedPoint: { x: bigint; y: bigint } | null = null;
  if (isEcrecover) {
    let s = 1n; // matches CommitASCEcrecover's constructor: s = 1
    for (const id of ids) {
      s = (s + (BigInt(id) % N_CURVE)) % N_CURVE;
    }
    claimedPoint = scalarMulG(s);
  }
  const createBlockArgs = isEcrecover ? [claimedPoint!.x, claimedPoint!.y] : [];

  let estimatedGas: bigint;
  try {
    estimatedGas = await ctx.publicClient.estimateContractGas({
      address,
      abi,
      functionName: "createBlock",
      args: createBlockArgs,
      account: ctx.walletClient.account!,
    });
  } catch (err) {
    return {
      status: "exceeds_block_gas_limit",
      n_elements: n,
      function: "createBlock",
      setup_tx_count: setupTxCount,
      notes: `cell=bench.commit_${variantId} n=${n}: eth_estimateGas itself refused (exceeds configured block gas limit ${BLOCK_GAS_LIMIT}); no transaction was sent. Raw: ${String(
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
      notes: `cell=bench.commit_${variantId} n=${n}: estimated gas ${estimatedGas} > block gas limit ${BLOCK_GAS_LIMIT}; no transaction was sent.`,
      duration_ms: 0,
    };
  }

  const t0 = process.hrtime.bigint();
  const commitHash = await ctx.walletClient.writeContract({
    address,
    abi,
    functionName: "createBlock",
    args: createBlockArgs,
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
    gas: BLOCK_GAS_LIMIT,
  });
  const commitReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: commitHash });
  const t1 = process.hrtime.bigint();

  return {
    duration_ms: formatDurationMs(t0, t1),
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

// ---------------------------------------------------------------- sys.plasma_* cells

const SYS_ARTIFACTS: Record<"v0" | "eccmath", string> = {
  v0: "PlasmaChainUTXOV0.sol/PlasmaChainUTXOV0.json",
  eccmath: "PlasmaChainUTXO.sol/PlasmaChainUTXO.json",
};

/** Deploys the full L2 system contract (pre- or post-ECCMath extraction),
 * funds it via createDepositUtxoBatch (chunked), and measures
 * createBlock() the same way benchCommitCell does. */
async function sysCommitCell(ctx: CellContext, variant: "v0" | "eccmath", n: number): Promise<CellResult> {
  const { abi, bytecode } = loadArtifact(SYS_ARTIFACTS[variant]);

  const deployHash = await ctx.walletClient.deployContract({
    abi,
    bytecode,
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
  });
  const deployReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: deployHash });
  const address = deployReceipt.contractAddress as Address;

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
      address,
      abi,
      functionName: "createDepositUtxoBatch",
      args: [idChunks[i], userChunks[i], token, amountChunks[i]],
      account: ctx.walletClient.account!,
      chain: ctx.walletClient.chain,
      gas: 250_000_000n,
    });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`sys.plasma_${variant}.n${n}: setup chunk ${i} reverted unexpectedly (tx ${hash})`);
    }
    setupTxCount++;
  }

  let estimatedGas: bigint;
  try {
    estimatedGas = await ctx.publicClient.estimateContractGas({
      address,
      abi,
      functionName: "createBlock",
      account: ctx.walletClient.account!,
    });
  } catch (err) {
    return {
      status: "exceeds_block_gas_limit",
      n_elements: n,
      function: "createBlock",
      setup_tx_count: setupTxCount,
      notes: `cell=sys.plasma_${variant} n=${n}: eth_estimateGas itself refused (exceeds configured block gas limit ${BLOCK_GAS_LIMIT}); no transaction was sent. Raw: ${String(
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
      notes: `cell=sys.plasma_${variant} n=${n}: estimated gas ${estimatedGas} > block gas limit ${BLOCK_GAS_LIMIT}; no transaction was sent.`,
      duration_ms: 0,
    };
  }

  const t0 = process.hrtime.bigint();
  const commitHash = await ctx.walletClient.writeContract({
    address,
    abi,
    functionName: "createBlock",
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
    gas: BLOCK_GAS_LIMIT,
  });
  const commitReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: commitHash });
  const t1 = process.hrtime.bigint();

  return {
    duration_ms: formatDurationMs(t0, t1),
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

// ---------------------------------------------------------------- L1 anchoring (n=100 only)

/**
 * Which of the seven commit variants get anchored on L1 (§4.3: "ukur gas +
 * calldata + jumlah tx submitBlock di L1 Sepolia (n=100 saja)"), and which
 * RootChainBench entry point matches their digest shape. CommitBaseline has
 * no digest at all (see CommitBaseline.sol) and is intentionally excluded.
 */
const L1_ANCHOR_VARIANTS: { id: string; contract: string; digestShape: "point" | "root" }[] = COMMIT_VARIANTS.filter(
  (v) => v.id !== "baseline"
).map((v) => ({
  ...v,
  digestShape: v.id === "asc_naive" || v.id === "asc_1sm" || v.id === "asc_ecrecover" ? ("point" as const) : ("root" as const),
}));

function loadSepoliaConfig(): { rpcUrl: string; pk: Hex } {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.L1_RPC;
  if (!rpcUrl) {
    throw new Error("SEPOLIA_RPC_URL (or L1_RPC) must be set in .env for L1 anchoring (not needed under --dry-run)");
  }
  const pk = process.env.OPERATOR_PRIVATE_KEY as Hex | undefined;
  if (!pk) {
    throw new Error("OPERATOR_PRIVATE_KEY must be set in .env for L1 anchoring (not needed under --dry-run)");
  }
  return { rpcUrl, pk };
}

function makeSepoliaClients(rpcUrl: string, pk: Hex) {
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 120_000 }) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl, { timeout: 120_000 }) });
  return { publicClient, walletClient, account };
}

/** JSON-serializes a viem receipt (bigint fields included) for archival under data/receipts/<RUN_ID>/. */
function receiptToJson(receipt: unknown): string {
  return JSON.stringify(receipt, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
}

/** Reads the final digest of a just-committed commit-variant contract, shaped per its digestShape. */
async function readDigest(
  ctx: CellContext,
  address: Address,
  abi: any,
  variantId: string,
  digestShape: "point" | "root"
): Promise<{ x: bigint; y: bigint } | { root: Hex }> {
  if (digestShape === "point") {
    const [x, y] = await Promise.all([
      ctx.publicClient.readContract({ address, abi, functionName: "accX" }) as Promise<bigint>,
      ctx.publicClient.readContract({ address, abi, functionName: "accY" }) as Promise<bigint>,
    ]);
    return { x, y };
  }
  if (variantId === "merkle") {
    const root = (await ctx.publicClient.readContract({ address, abi, functionName: "getRoot" })) as Hex;
    return { root };
  }
  if (variantId === "keccak") {
    const digest = (await ctx.publicClient.readContract({ address, abi, functionName: "digest" })) as Hex;
    return { root: digest };
  }
  // scalar: s is a bare uint256, not a bytes32 -- pad it the same way the
  // other root-shaped variants' bytes32 digests are naturally represented.
  const s = (await ctx.publicClient.readContract({ address, abi, functionName: "s" })) as bigint;
  return { root: (`0x${s.toString(16).padStart(64, "0")}`) as Hex };
}

/**
 * L2 half of one L1-anchor repetition: deploy the variant contract fresh,
 * fund it with n elements (chunked), estimate-then-send createBlock() the
 * same way benchCommitCell does. Kept separate from benchCommitCell (rather
 * than reusing it) because the caller also needs the deployed address+abi
 * afterward, to read the digest that gets anchored on L1.
 */
async function deployAndCommitForAnchor(
  ctx: CellContext,
  variantId: string,
  contractName: string,
  n: number
): Promise<{ address: Address; abi: any; l2Result: CellResult }> {
  const { abi, bytecode } = loadArtifact(`${contractName}.sol/${contractName}.json`);

  const deployHash = await ctx.walletClient.deployContract({
    abi,
    bytecode,
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
  });
  const deployReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: deployHash });
  const address = deployReceipt.contractAddress as Address;

  const ids = idsForVariant(variantId, deriveElementIds(ctx.seed, n));
  const idChunks = chunk(ids, SETUP_CHUNK_SIZE);
  let setupTxCount = 0;
  for (const idsChunk of idChunks) {
    const hash = await ctx.walletClient.writeContract({
      address,
      abi,
      functionName: "addPendingBatch",
      args: [idsChunk],
      account: ctx.walletClient.account!,
      chain: ctx.walletClient.chain,
      gas: 250_000_000n,
    });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`L1-anchor L2 setup for ${variantId} n=${n}: setup chunk reverted unexpectedly (tx ${hash})`);
    }
    setupTxCount++;
  }

  const isEcrecover = variantId === "asc_ecrecover";
  let createBlockArgs: unknown[] = [];
  if (isEcrecover) {
    let s = 1n;
    for (const id of ids) s = (s + (BigInt(id) % N_CURVE)) % N_CURVE;
    const claimedPoint = scalarMulG(s);
    createBlockArgs = [claimedPoint.x, claimedPoint.y];
  }

  let estimatedGas: bigint;
  try {
    estimatedGas = await ctx.publicClient.estimateContractGas({
      address,
      abi,
      functionName: "createBlock",
      args: createBlockArgs,
      account: ctx.walletClient.account!,
    });
  } catch (err) {
    return {
      address,
      abi,
      l2Result: {
        status: "exceeds_block_gas_limit",
        n_elements: n,
        function: "createBlock",
        setup_tx_count: setupTxCount,
        notes: `L1-anchor L2 setup for ${variantId} n=${n}: eth_estimateGas itself refused. Raw: ${String(
          (err as Error).message
        ).slice(0, 200)}`,
        duration_ms: 0,
      },
    };
  }
  if (estimatedGas > BLOCK_GAS_LIMIT) {
    return {
      address,
      abi,
      l2Result: {
        status: "exceeds_block_gas_limit",
        n_elements: n,
        function: "createBlock",
        setup_tx_count: setupTxCount,
        notes: `L1-anchor L2 setup for ${variantId} n=${n}: estimated gas ${estimatedGas} > block gas limit ${BLOCK_GAS_LIMIT}.`,
        duration_ms: 0,
      },
    };
  }

  const commitHash = await ctx.walletClient.writeContract({
    address,
    abi,
    functionName: "createBlock",
    args: createBlockArgs,
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain,
    gas: BLOCK_GAS_LIMIT,
  });
  const commitReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: commitHash });

  return {
    address,
    abi,
    l2Result: {
      status: commitReceipt.status === "success" ? "ok" : "error",
      function: "createBlock",
      n_elements: n,
      gas_used: Number(commitReceipt.gasUsed),
      setup_tx_count: setupTxCount,
      duration_ms: 0,
    },
  };
}

/**
 * §4.3's L1 half: for each of the six digest-bearing variants, L1_REPETITIONS
 * times, build a fresh n=100 block on L2, then anchor its digest on Sepolia
 * via RootChainBench and record gas/calldata/tx_count/tx_hash, saving the
 * full receipt to data/receipts/<RUN_ID>/. Writes into the SAME RecordWriter
 * (and therefore the same JSONL file) the L2 campaign already produced, so
 * L1 and L2 rows for a run live side by side under one RUN_ID. Never called
 * under --dry-run (see main()).
 */
async function runL1AnchorCampaign(writer: RecordWriter, runId: string, dataRoot: string): Promise<void> {
  const { rpcUrl, pk } = loadSepoliaConfig();
  const sepoliaClients = makeSepoliaClients(rpcUrl, pk);

  const rootChainBenchArtifact = loadArtifact(ROOT_CHAIN_BENCH_ARTIFACT);
  console.log(`[e1_commit_cost] deploying RootChainBench to Sepolia (operator ${sepoliaClients.account.address})...`);
  const deployHash = await sepoliaClients.walletClient.deployContract({
    abi: rootChainBenchArtifact.abi,
    bytecode: rootChainBenchArtifact.bytecode,
    account: sepoliaClients.account,
    chain: sepolia,
  });
  const deployReceipt = await sepoliaClients.publicClient.waitForTransactionReceipt({ hash: deployHash });
  const rootChainBenchAddress = deployReceipt.contractAddress as Address;
  console.log(`[e1_commit_cost] RootChainBench deployed at ${rootChainBenchAddress} (tx ${deployHash})`);

  const anvilConfig = loadAnvilConfig();
  const operatorKey = loadOperatorPrivateKey();
  const { publicClient: l2PublicClient, operatorWalletClient: l2WalletClient, operatorAccount } = makeClients(
    anvilConfig,
    operatorKey
  );

  const receiptsDir = path.join(dataRoot, RECEIPTS_DIR_NAME, runId);
  mkdirSync(receiptsDir, { recursive: true });

  const envHash = computeEnvHash(REPO_ROOT);

  for (const variant of L1_ANCHOR_VARIANTS) {
    for (let r = 0; r < L1_REPETITIONS; r++) {
      const seed = seedFor(BASE_SEED, r);
      const l2Ctx: CellContext = {
        publicClient: l2PublicClient,
        walletClient: l2WalletClient,
        operatorAddress: operatorAccount.address,
        seed,
      };
      const cellId = `e1.${variant.id}.l1_anchor.n${L1_ANCHOR_N}`;
      const startedAt = new Date().toISOString();

      console.log(`[e1_commit_cost] L1 anchor: ${cellId} rep=${r} -- building n=${L1_ANCHOR_N} block on L2 first...`);
      const { address, abi, l2Result } = await deployAndCommitForAnchor(l2Ctx, variant.id, variant.contract, L1_ANCHOR_N);

      const baseRecord: BenchRecord = {
        run_id: runId,
        cell_id: cellId,
        repetition: r,
        seed,
        started_at: startedAt,
        duration_ms: 0,
        layer: "L1",
        function: "submitBlock",
        n_elements: L1_ANCHOR_N,
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
        setup_tx_count: l2Result.setup_tx_count ?? null,
        test_name: null,
        assert_result: null,
      };

      if (l2Result.status === "exceeds_block_gas_limit") {
        writer.write({
          ...baseRecord,
          tx_count: 0,
          status: "exceeds_block_gas_limit",
          notes: `L2 side of the anchor (createBlock on ${variant.contract} at n=${L1_ANCHOR_N}) itself exceeded the block gas limit; no L1 transaction was attempted. ${
            l2Result.notes ?? ""
          }`,
        });
        continue;
      }

      const digest = await readDigest(l2Ctx, address, abi, variant.id, variant.digestShape);

      const t0 = process.hrtime.bigint();
      const submitHash: Hex =
        "root" in digest
          ? await sepoliaClients.walletClient.writeContract({
              address: rootChainBenchAddress,
              abi: rootChainBenchArtifact.abi,
              functionName: "submitBlockRoot",
              args: [digest.root],
              account: sepoliaClients.account,
              chain: sepolia,
              gas: L1_TX_GAS_LIMIT,
            })
          : await sepoliaClients.walletClient.writeContract({
              address: rootChainBenchAddress,
              abi: rootChainBenchArtifact.abi,
              functionName: "submitBlockPoint",
              args: [digest.x, digest.y],
              account: sepoliaClients.account,
              chain: sepolia,
              gas: L1_TX_GAS_LIMIT,
            });
      const submitReceipt = await sepoliaClients.publicClient.waitForTransactionReceipt({ hash: submitHash });
      const t1 = process.hrtime.bigint();

      const tx = await sepoliaClients.publicClient.getTransaction({ hash: submitHash });
      const byteStats = calldataByteStats(tx.input);

      const receiptPath = path.join(receiptsDir, `${cellId.replace(/\./g, "_")}_rep${r}.json`);
      writeFileSync(receiptPath, receiptToJson(submitReceipt), "utf8");

      writer.write({
        ...baseRecord,
        duration_ms: formatDurationMs(t0, t1),
        gas_used: Number(submitReceipt.gasUsed),
        gas_limit: Number(L1_TX_GAS_LIMIT),
        calldata_bytes: byteStats.total,
        calldata_zero_bytes: byteStats.zero,
        calldata_nonzero_bytes: byteStats.nonzero,
        tx_count: 1,
        tx_hash: submitHash,
        block_number: Number(submitReceipt.blockNumber),
        status: submitReceipt.status === "success" ? "ok" : "error",
        notes: `receipt saved to ${receiptPath}`,
      });

      console.log(`[e1_commit_cost] L1 anchor: ${cellId} rep=${r} gas=${submitReceipt.gasUsed} tx=${submitHash}`);
    }
  }
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const runId =
    process.env.RUN_ID || `e1_${DRY_RUN ? "dryrun_" : ""}${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const dataRoot = path.join(REPO_ROOT, process.env.DATA_ROOT || "data");
  const outputFilename = "e1_commit_cost.jsonl";

  const cells: Cell[] = [];
  for (const variant of COMMIT_VARIANTS) {
    for (const n of BENCH_N_VALUES) {
      cells.push({
        id: `bench.commit_${variant.id}.n${n}`,
        layer: "L2",
        fn: (ctx) => benchCommitCell(ctx, variant.id, variant.contract, n),
      });
    }
  }
  for (const variant of ["v0", "eccmath"] as const) {
    for (const n of SYS_N_VALUES) {
      cells.push({
        id: `sys.plasma_${variant}.n${n}`,
        layer: "L2",
        fn: (ctx) => sysCommitCell(ctx, variant, n),
      });
    }
  }

  console.log(
    `[e1_commit_cost] run_id=${runId} dry_run=${DRY_RUN} repetitions=${REPETITIONS} l1_repetitions=${L1_REPETITIONS} cells=${cells.length}`
  );

  const writer = await runCampaign({
    runId,
    dataRoot,
    outputFilename,
    repoRoot: REPO_ROOT,
    cells,
    repetitions: REPETITIONS,
    warmupBatches: DRY_RUN ? 0 : parseInt(process.env.WARMUP_BATCHES || "3", 10),
    baseSeed: BASE_SEED,
  });

  console.log(`[e1_commit_cost] L2 campaign complete -> ${writer.path}`);

  if (DRY_RUN) {
    console.log("[e1_commit_cost] --dry-run: skipping L1 Sepolia anchoring entirely, no L1 transaction sent.");
  } else {
    await runL1AnchorCampaign(writer, runId, dataRoot);
  }

  const lines = readFileSync(writer.path, "utf8").trim().split("\n");
  console.log(`\n[e1_commit_cost] sample JSONL lines (${lines.length} total):`);
  for (const line of lines.slice(0, 5)) console.log(line);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
