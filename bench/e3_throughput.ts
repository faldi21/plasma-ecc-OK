/**
 * E3 -- throughput factorial campaign (docs/TICKETS.md T7;
 * docs/EXPERIMENT_PRD.md §6). Primitive {ASC, Merkle} x Placement
 * {inline, deferred}, plus a Keccak-deferred control -- 5 cells:
 *
 *   asc.inline       PlasmaChainUTXOInline.sol       (reconstruction, T7)
 *   asc.deferred     PlasmaChainUTXO.sol             (existing)
 *   merkle.inline    PlasmaChainUTXOMerkleInline.sol (reconstruction, T7)
 *   merkle.deferred  PlasmaChainUTXOMerkle.sol       (existing)
 *   keccak.deferred  PlasmaChainUTXOKeccak.sol       (reconstruction, T7)
 *
 * See docs/EXPERIMENT_PRD.md §6.1's provenance table for why the three
 * reconstructions exist and aren't vendored, and contracts/test/
 * E3PlacementParity.t.sol for the digest-parity proof each inline cell
 * needed before being trusted here. The optional 6th cell from docs/
 * TICKETS.md T7 ("ASC inline-1SM, kalau sudah ada dari T2") is NOT
 * included: T2 only produced the digest math (contracts/src/commit/
 * CommitASC1SM.sol), not a transferUtxoBatch-capable system contract, so
 * it isn't "already available" in the form E3 needs -- out of scope here,
 * left as a follow-up.
 *
 * Every cell measures ONLY transferUtxoBatch -- createBlock() is never
 * called (docs/TICKETS.md T6's established E1/E3 separation: E1 owns
 * commit-cost measurement, E3 owns throughput). For the two "deferred"
 * cells this means the accumulator/digest is never touched at all during
 * the measured window (that's what "deferred" means); for "inline" cells
 * accumulator.add() runs inside every transferUtxoBatch call, which is
 * exactly the cost E3 is isolating.
 *
 * Workload (docs/EXPERIMENT_PRD.md §6.2): K >= 20 sender accounts -- per
 * docs/TICKETS.md T7's explicit reminder, the hot path is transferUtxoBatch
 * driven by real K accounts, NOT the operator depositing. Sender
 * assignment is a SEEDED PERMUTATION WITHOUT REPLACEMENT (one unique
 * account per batch per cell run), not random-with-replacement -- see
 * §6.2's own note on why: replacement let the same account land on two
 * batches, and under C-way concurrency that meant one account's nonce
 * needed cross-batch serialization, which produced an intermittent
 * stuck-batch bug across several fix attempts before this was traced back
 * to its actual cause. Receiver (output owner) picks are still random
 * with replacement among K, seeded. B = 100 per batch, C = 3 concurrent
 * batches in flight, W = 3 warm-up batches (discarded), T in
 * {500, 1000, 1500, 2000} (total logical transfers per run, so
 * T/B batches per run -- numBatches must not exceed K, enforced), N
 * repetitions (default from N_REPS env, 30), cell x T order shuffled per
 * repetition.
 *
 * Setup (deploy, account funding via createDepositUtxoBatch, batch-sender
 * assignment) is entirely UNMEASURED. The measured window is exactly
 * "first batch tx submitted" to "last batch receipt received" -- ops
 * counted via Promise.allSettled, so one failed/slow batch never aborts
 * the others (docs/EXPERIMENT_PRD.md §6.3).
 *
 * Usage:
 *   npx tsx bench/e3_throughput.ts --repetitions 1 --t-values 500
 *   npx tsx bench/e3_throughput.ts --repetitions 30 --confirm
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deriveAccountKey, deriveElementIds, loadOperatorPrivateKey } from "./harness/accounts.js";
import { makeClients, loadAnvilConfig, setBalance } from "./harness/anvil.js";
import { formatDurationMs, RecordWriter, computeEnvHash, type BenchRecord } from "./harness/record.js";
import { seedFor, shuffle, mulberry32 } from "./harness/rng.js";
import { requireRunId } from "./harness/guards.js";
import { startFreshAnvil, type AnvilHandle } from "./harness/anvil_lifecycle.js";

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

/** --resume: append to an existing result file, skipping (cell_id, repetition) pairs already recorded. */
const RESUME = process.argv.includes("--resume");
const REPETITIONS = parseInt(parseArg("--repetitions", process.env.N_REPS || "30"), 10);
const T_VALUES = parseArg("--t-values", "500,1000,1500,2000")
  .split(",")
  .map((s) => parseInt(s.trim(), 10));
const CONFIRM = process.argv.includes("--confirm");
const BASE_SEED = parseInt(parseArg("--seed", "196938"), 10); // 0x30138 ("E3" leetish)

// ---------------------------------------------------------------- Constants

const K_ACCOUNTS = parseInt(process.env.ACCOUNTS_K || "20", 10);
const B = parseInt(process.env.BATCH_B || "100", 10);
const C = parseInt(process.env.CONCURRENCY_C || "3", 10);
const W = parseInt(process.env.WARMUP_BATCHES || "3", 10);
const ACCOUNT_INITIAL_ETH = "0x21e19e0c9bab2400000" as Hex; // 10000 ETH each
const DEPOSIT_TOKEN = "0x000000000000000000000000000000000000dEaD" as Address;
// A tx's own gas limit must stay BELOW the node's configured block gas
// limit (300_000_000, per .env.paper1's ANVIL_GAS_LIMIT), not equal to
// it: a tx that alone claims the ENTIRE block's capacity leaves Anvil no
// room to actually include it, so it sits pending forever instead of
// reverting or mining -- caught empirically (a stuck merkle.inline batch,
// nonce never advancing, gas field showing exactly 0x11e1a300 = 300M in
// the txpool). 280M leaves comfortable headroom under the real ceiling.
const TRANSFER_BATCH_GAS = 280_000_000n;
const ASSUMED_SECONDS_PER_BATCH = 2; // rough estimate for the pre-run duration printout, see main()
// Hard ceiling on how long sendBatch waits for a receipt before giving up
// and recording status="batch_timeout" -- replaces relying on viem's own
// default polling/timeout, which was observed taking ~6 minutes on a
// stuck batch (see git history around this constant's introduction).
const BATCH_TIMEOUT_MS = 60_000;
// Memory guard (ANALYSIS_PLAN.md Amandemen 2). One fresh Anvil per run
// means memory cannot accumulate across runs any more, but a single
// pathological run could still balloon; this stops the campaign with a
// recorded reason instead of waiting for the OOM killer, which is what
// truncated the previous attempt's output file mid-write.
const ANVIL_MAX_RSS_MB = parseInt(process.env.E3_ANVIL_MAX_RSS_MB || "4096", 10);
const ANVIL_RSS_POLL_MS = 2_000;

interface E3Cell {
  id: string;
  artifact: string; // path under out/
}

const CELLS: E3Cell[] = [
  { id: "asc.inline", artifact: "PlasmaChainUTXOInline.sol/PlasmaChainUTXOInline.json" },
  { id: "asc.deferred", artifact: "PlasmaChainUTXO.sol/PlasmaChainUTXO.json" },
  { id: "merkle.inline", artifact: "PlasmaChainUTXOMerkleInline.sol/PlasmaChainUTXOMerkleInline.json" },
  { id: "merkle.deferred", artifact: "PlasmaChainUTXOMerkle.sol/PlasmaChainUTXOMerkle.json" },
  { id: "keccak.deferred", artifact: "PlasmaChainUTXOKeccak.sol/PlasmaChainUTXOKeccak.json" },
];

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

/** Deterministic string -> uint32 hash (FNV-1a), so a cell's string id can
 * feed into seedFor() the same way a numeric repetition index does. */
function stringHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A per-account wallet client, one per K sender account. Deliberately does
 * NOT use viem's nonceManager: an earlier draft did (to guard against
 * concurrent same-account sends when sender assignment was random WITH
 * replacement), but that combination produced an intermittent stuck-batch
 * bug (a batch's tx would sit pending for minutes before either mining or
 * timing out) that never fully resolved across several fix attempts.
 * Sender assignment is now a permutation WITHOUT replacement (see
 * runE3Cell), so each account sends exactly ONE transaction per cell run --
 * nonceManager's whole job (serializing concurrent sends from the SAME
 * account) is structurally unnecessary, and each batch's nonce is instead
 * fetched once via eth_getTransactionCount and passed explicitly (see
 * batchSenderNonce), removing any nonce-caching behavior as a variable.
 */
function makeAccountWalletClient(cfg: ReturnType<typeof loadAnvilConfig>, pk: Hex) {
  const chain = {
    id: cfg.chainId,
    name: "Plasma L2 Bench",
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrls: { default: { http: [cfg.rpcUrl] }, public: { http: [cfg.rpcUrl] } },
  } as const;
  const account = privateKeyToAccount(pk);
  return createWalletClient({ account, chain, transport: http(cfg.rpcUrl, { timeout: 60_000 }) });
}

/** Runs `items` through `worker` with at most `concurrency` in flight at
 * once. `worker` must never throw -- callers record per-item outcome
 * (success/failure/latency) internally so one bad batch doesn't abort the
 * rest (docs/EXPERIMENT_PRD.md §6.3's Promise.allSettled requirement). */
async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, idx: number) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------- Cell run

interface E3RunResult {
  durationMs: number;
  opsCompleted: number;
  opsFailed: number;
  opsRetried: number;
  latencyMs: number[];
  timeoutEvents: { batchIdx: number; hash: Hex }[];
}

/**
 * One full (cell, T) run: deploy fresh, fund K accounts (unmeasured),
 * assign each of the T/B batches to a random sender (seeded), then submit
 * all batches with concurrency C and measure submit-to-last-receipt.
 */
async function runE3Cell(
  anvilConfig: ReturnType<typeof loadAnvilConfig>,
  cell: E3Cell,
  T: number,
  seed: number
): Promise<E3RunResult> {
  const operatorKey = loadOperatorPrivateKey();
  const { publicClient, operatorWalletClient, operatorAccount } = makeClients(anvilConfig, operatorKey);

  const { abi, bytecode } = loadArtifact(cell.artifact);
  const deployHash = await operatorWalletClient.deployContract({
    abi,
    bytecode,
    account: operatorWalletClient.account!,
    chain: operatorWalletClient.chain,
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const address = deployReceipt.contractAddress as Address;

  const numBatches = Math.ceil(T / B);
  if (numBatches > K_ACCOUNTS) {
    throw new Error(
      `e3.${cell.id}.T${T}: numBatches=${numBatches} exceeds K_ACCOUNTS=${K_ACCOUNTS}. Sender assignment is a permutation without replacement (one unique account per batch -- docs/EXPERIMENT_PRD.md §6.2), so K must cover every batch in a single cell run. Increase ACCOUNTS_K or reduce T/B.`
    );
  }
  // deriveAccounts() (harness/accounts.ts) returns viem PrivateKeyAccount
  // objects, which do NOT expose the raw private key back (viem doesn't
  // put it on the object) -- derive keys directly instead so each account
  // can sign its own transferUtxoBatch calls.
  const accountKeys: Hex[] = Array.from({ length: K_ACCOUNTS }, (_, i) => deriveAccountKey(seed, i));
  const accounts = accountKeys.map((pk) => privateKeyToAccount(pk));
  const accountClients = accountKeys.map((pk) => makeAccountWalletClient(anvilConfig, pk));

  // Fund every account with ETH for gas (Anvil cheat -- these are fresh
  // deterministic keys, never funded by genesis).
  for (const account of accounts) {
    await setBalance(publicClient, account.address, ACCOUNT_INITIAL_ETH);
  }

  // Sender assignment: a SEEDED PERMUTATION WITHOUT REPLACEMENT, one
  // unique account per batch -- not random-with-replacement. See
  // docs/EXPERIMENT_PRD.md §6.2 for why: with replacement, the same
  // account could be assigned to two batches within one cell run, and
  // under C-way concurrency the second occurrence can start while the
  // first is still in flight, which serializes on that account's nonce --
  // a confound that differs run to run depending on which accounts happen
  // to collide, not a property of the cell being measured. A unique
  // sender per batch removes per-account nonce ordering as a variable
  // entirely.
  const rand = mulberry32(seedFor(seed, 1));
  const senderPermutation = shuffle(
    Array.from({ length: K_ACCOUNTS }, (_, i) => i),
    seedFor(seed, 2)
  );
  const batchSenderIdx = senderPermutation.slice(0, numBatches);

  // Explicit nonce per batch, fetched ONCE here (unmeasured setup) rather
  // than relying on viem's nonceManager: with a unique sender per batch,
  // each account sends exactly one transaction for the rest of this run,
  // so its current on-chain nonce is correct and stable to reuse -- no
  // manager/cache needed, and one less source of non-determinism.
  const batchSenderNonce: number[] = [];
  for (const senderIdx of batchSenderIdx) {
    batchSenderNonce.push(await publicClient.getTransactionCount({ address: accounts[senderIdx].address }));
  }

  // Fund each sender with exactly enough UTXOs for the batches assigned to
  // it: B deposit UTXOs per assigned batch, owned by that sender.
  const batchesPerSender = new Map<number, number>();
  for (const idx of batchSenderIdx) batchesPerSender.set(idx, (batchesPerSender.get(idx) ?? 0) + 1);

  const batchInputIds: bigint[][] = Array.from({ length: numBatches }, () => []);
  let setupTxCount = 0;
  for (const [senderIdx, count] of batchesPerSender) {
    const n = count * B;
    const ids = deriveElementIds(seedFor(seed, 1000 + senderIdx), n);
    const idChunks = chunk(ids, 100);
    for (const idsChunk of idChunks) {
      const users = idsChunk.map(() => accounts[senderIdx].address);
      const amounts = idsChunk.map(() => 1_000_000_000_000_000_000n);
      const hash = await operatorWalletClient.writeContract({
        address,
        abi,
        functionName: "createDepositUtxoBatch",
        args: [idsChunk, users, DEPOSIT_TOKEN, amounts],
        account: operatorWalletClient.account!,
        chain: operatorWalletClient.chain,
        gas: 250_000_000n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`e3.${cell.id}.T${T}: funding chunk for sender ${senderIdx} reverted unexpectedly (tx ${hash})`);
      }
      setupTxCount++;
    }
    // Assign this sender's B-sized id chunks to its batches, in order.
    let cursor = 0;
    for (let b = 0; b < numBatches; b++) {
      if (batchSenderIdx[b] !== senderIdx) continue;
      batchInputIds[b] = ids.slice(cursor, cursor + B).map((id) => BigInt(id));
      cursor += B;
    }
  }

  // Output owners per batch: random pick among K accounts, seeded --
  // "pasangan pengirim-penerima acak" (§6.2).
  const batchOutputOwners: Address[][] = [];
  for (let b = 0; b < numBatches; b++) {
    const owners: Address[] = [];
    for (let i = 0; i < B; i++) {
      owners.push(accounts[Math.floor(rand() * K_ACCOUNTS)].address);
    }
    batchOutputOwners.push(owners);
  }

  /**
   * Sends batch `b` and waits for its receipt, with a HARD 60s ceiling on
   * the wait (not viem's own default polling, which can run for minutes).
   * The tx hash is captured before the wait starts, so a timeout still
   * reports something traceable rather than nothing -- an anomaly must
   * show up as data (status="batch_timeout" + tx_hash in the run's notes),
   * never get silently absorbed into duration_ms.
   */
  // Explicit flush of the final batch (ANALYSIS_PLAN.md Amandemen 3).
  // Anvil auto-mines when a transaction ARRIVES, and two transactions
  // carrying TRANSFER_BATCH_GAS (280M) cannot share a 300M block, so a
  // transaction that does not fit waits for the next arrival to trigger a
  // block. The last batch of a run has no successor, so it used to hang
  // until BATCH_TIMEOUT_MS and be recorded as B failed ops -- in every
  // run, on every cell. One evm_mine is fired the moment the final batch
  // has been submitted: identical for every cell and every T, exactly
  // once per run, never repeated. If ops still fail after it, they are
  // recorded as ops_failed exactly as they happen.
  let submittedCount = 0;
  let flushed = false;
  async function flushIfAllSubmitted(): Promise<void> {
    submittedCount += 1;
    if (flushed || submittedCount < numBatches) return;
    flushed = true;
    await publicClient.request({ method: "evm_mine" as any, params: [] as any });
  }

  async function sendBatch(b: number): Promise<{ status: "ok" | "failed" | "batch_timeout"; hash: Hex; gasUsed?: bigint }> {
    const senderClient = accountClients[batchSenderIdx[b]];
    const inputs = batchInputIds[b].map((id) => `0x${id.toString(16).padStart(64, "0")}` as Hex);
    const outputOwners = batchOutputOwners[b];
    const outputAmounts = inputs.map(() => 1_000_000_000_000_000_000n);
    const outputCounts = inputs.map(() => 1);
    const hash = await senderClient.writeContract({
      address,
      abi,
      functionName: "transferUtxoBatch",
      args: [inputs, outputOwners, outputAmounts, outputCounts],
      account: senderClient.account!,
      chain: senderClient.chain,
      gas: TRANSFER_BATCH_GAS,
      nonce: batchSenderNonce[b],
    });
    // Submitted. If this was the last batch of the run, nudge the node
    // once so nothing is left waiting for a trigger that will never come.
    await flushIfAllSubmitted();

    const receiptPromise = publicClient.waitForTransactionReceipt({ hash });
    const timeoutPromise = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), BATCH_TIMEOUT_MS));
    const raced = await Promise.race([receiptPromise, timeoutPromise]);
    if (raced === "timeout") {
      return { status: "batch_timeout", hash };
    }
    return { status: raced.status === "success" ? "ok" : "failed", hash, gasUsed: raced.gasUsed };
  }

  // Warm-up: W batches, discarded (docs/EXPERIMENT_PRD.md §6.2's W=3,
  // "buang efek JIT/koneksi"). Uses a DEDICATED account outside the K
  // measured accounts -- NOT accounts[0] -- so warm-up traffic can never
  // advance the nonce of an account that's also assigned as a measured
  // batch's sender. That exact collision (accounts[0] doing warm-up AND
  // being picked by the sender permutation for a real batch) was a real
  // bug: batchSenderNonce is fetched once, before warm-up runs, so
  // warm-up's own sends silently advanced that account's real on-chain
  // nonce past the value already captured, and the later explicit-nonce
  // send failed with "Nonce provided ... is lower than the current nonce".
  {
    const warmupKey = deriveAccountKey(seed, K_ACCOUNTS + 1_000_000); // well outside 0..K_ACCOUNTS-1
    const warmupAccount = privateKeyToAccount(warmupKey);
    const warmupClient = makeAccountWalletClient(anvilConfig, warmupKey);
    await setBalance(publicClient, warmupAccount.address, ACCOUNT_INITIAL_ETH);

    const warmupIds = deriveElementIds(seedFor(seed, 999_999), W * B);
    for (const idsChunk of chunk(warmupIds, 100)) {
      const users = idsChunk.map(() => warmupAccount.address);
      const amounts = idsChunk.map(() => 1_000_000_000_000_000_000n);
      const hash = await operatorWalletClient.writeContract({
        address,
        abi,
        functionName: "createDepositUtxoBatch",
        args: [idsChunk, users, DEPOSIT_TOKEN, amounts],
        account: operatorWalletClient.account!,
        chain: operatorWalletClient.chain,
        gas: 250_000_000n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    for (let w = 0; w < W; w++) {
      const inputs = warmupIds.slice(w * B, (w + 1) * B);
      const outputOwners = inputs.map(() => warmupAccount.address); // sends to itself -- discarded either way
      const outputAmounts = inputs.map(() => 1_000_000_000_000_000_000n);
      const outputCounts = inputs.map(() => 1);
      const hash = await warmupClient.writeContract({
        address,
        abi,
        functionName: "transferUtxoBatch",
        args: [inputs, outputOwners, outputAmounts, outputCounts],
        account: warmupClient.account!,
        chain: warmupClient.chain,
        gas: TRANSFER_BATCH_GAS,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  // ---- measured window: first batch submitted -> last receipt received ----
  const latencyMs: number[] = new Array(numBatches).fill(0);
  const timeoutEvents: { batchIdx: number; hash: Hex }[] = [];
  let opsCompleted = 0;
  let opsFailed = 0;
  let opsRetried = 0;

  const t0 = process.hrtime.bigint();
  await runWithConcurrency(
    Array.from({ length: numBatches }, (_, i) => i),
    C,
    async (b) => {
      const bt0 = process.hrtime.bigint();
      let result = await sendBatch(b).catch(() => ({ status: "failed" as const, hash: "0x0" as Hex }));
      // Only retry a definitive failure (reverted/errored tx) -- NOT a
      // timeout: the original tx may still land later, and firing a
      // second one at it risks a second competing tx from the same
      // account/nonce. A timeout is recorded and left alone.
      if (result.status === "failed") {
        opsRetried++;
        result = await sendBatch(b).catch(() => ({ status: "failed" as const, hash: "0x0" as Hex }));
      }
      const bt1 = process.hrtime.bigint();
      latencyMs[b] = formatDurationMs(bt0, bt1);
      if (result.status === "ok") {
        opsCompleted += B;
      } else {
        opsFailed += B;
        if (result.status === "batch_timeout") timeoutEvents.push({ batchIdx: b, hash: result.hash });
      }
    }
  );
  const t1 = process.hrtime.bigint();

  return {
    durationMs: formatDurationMs(t0, t1),
    opsCompleted,
    opsFailed,
    opsRetried,
    latencyMs,
    timeoutEvents,
  };
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const runId = requireRunId();
  const dataRoot = path.join(REPO_ROOT, process.env.DATA_ROOT || "data");
  const outputFilename = "e3_throughput.jsonl";

  const combos: { cell: E3Cell; T: number }[] = [];
  for (const cell of CELLS) for (const T of T_VALUES) combos.push({ cell, T });

  const totalRuns = combos.length * REPETITIONS;
  const estimatedSeconds = combos.reduce((sum, { T }) => sum + Math.ceil(T / B) * ASSUMED_SECONDS_PER_BATCH, 0) * REPETITIONS;
  const estimatedMinutes = estimatedSeconds / 60;

  console.log(
    `[e3_throughput] run_id=${runId} cells=${CELLS.length} t_values=[${T_VALUES.join(",")}] repetitions=${REPETITIONS} K=${K_ACCOUNTS} B=${B} C=${C} W=${W}`
  );
  console.log(
    `[e3_throughput] total runs=${totalRuns}, rough estimate=${estimatedMinutes.toFixed(1)} min (assumes ~${ASSUMED_SECONDS_PER_BATCH}s/batch -- a guess, not measured; refine from this run's own latency_ms afterward)`
  );

  if (estimatedMinutes > 30 && !CONFIRM) {
    console.error(
      `[e3_throughput] estimated duration exceeds 30 minutes. Re-run with --confirm to proceed, or reduce --repetitions / --t-values.`
    );
    process.exit(1);
  }

  // One fresh Anvil per run (ANALYSIS_PLAN.md Amandemen 2): no shared
  // node to reach, so nothing to pre-check here -- startFreshAnvil() below
  // owns the node's whole lifecycle, including refusing to start if
  // something else is already listening on the port.
  const anvilPort = parseInt(process.env.ANVIL_PORT || "8546", 10);
  const anvilGasLimit = process.env.ANVIL_GAS_LIMIT || "300000000";
  const anvilFundEth = process.env.ANVIL_FUND_ETH || "10000";
  // The only account that must exist before the harness runs: the operator
  // deploys every contract and sends every operator transaction. E3's K
  // sender accounts are derived per cell and funded inside runE3Cell via
  // anvil_setBalance, so they are deliberately not pre-funded here.
  const fundKeys: Hex[] = [loadOperatorPrivateKey()];

  const writer = new RecordWriter(dataRoot, runId, outputFilename, { resume: RESUME });
  let resumeSkipped = 0;
  let resumeRan = 0;
  const envHash = computeEnvHash(REPO_ROOT);
  const overheads: { bootMs: number; fundMs: number; totalMs: number }[] = [];
  let peakRssOverall = 0;

  for (let r = 0; r < REPETITIONS; r++) {
    const repSeed = seedFor(BASE_SEED, r);
    const orderedCombos = shuffle(combos, repSeed);

    for (const { cell, T } of orderedCombos) {
      const cellId = `e3.${cell.id}.T${T}`;
      // --resume: this (cell, repetition) is already on disk -- skip the
      // whole run of it, never re-run and never rewrite.
      if (RESUME && writer.has(cellId, r)) {
        resumeSkipped += 1;
        continue;
      }
      resumeRan += 1;
      // MUST fold in cell.id, not just T: multiple cells share the same T
      // value (that's the whole point of the factorial design), so
      // seedFor(repSeed, T) alone would derive the IDENTICAL K accounts
      // for every cell at a given T -- confirmed the hard way: the first
      // smoke run reused accounts across cells, and viem's nonceManager
      // (needed for concurrent same-account sends, see
      // makeAccountWalletClient's docblock) caches nonce state per
      // address for the life of the process, so cross-cell address reuse
      // let each cell's run drift the SAME cached nonce state left behind
      // by the previous cell's now-destroyed contract deployment.
      const cellSeed = seedFor(seedFor(repSeed, T), stringHash(cell.id));
      const startedAt = new Date().toISOString();

      console.log(`[e3_throughput] rep=${r} ${cellId} starting...`);

      // --- fresh node for THIS run (Amandemen 2) ---------------------
      const tRunStart = process.hrtime.bigint();
      let anvil: AnvilHandle;
      try {
        anvil = await startFreshAnvil({
          port: anvilPort,
          gasLimit: anvilGasLimit,
          fundKeys,
          fundEth: anvilFundEth,
        });
      } catch (err) {
        console.error(`[e3_throughput] FATAL: tidak bisa menyalakan Anvil untuk ${cellId} rep=${r}: ${(err as Error).message}`);
        process.exit(1);
      }
      const anvilConfig = { rpcUrl: anvil.rpcUrl, chainId: 31337 };

      // Sample the node's RSS while the run executes; reading /proc every
      // couple of seconds cannot perturb the measurement.
      let guardTripped: { rssMb: number } | null = null;
      const rssTimer = setInterval(() => {
        const rss = anvil.rssBytes();
        if (rss !== null && rss / (1024 * 1024) > ANVIL_MAX_RSS_MB) {
          guardTripped = { rssMb: rss / (1024 * 1024) };
        }
      }, ANVIL_RSS_POLL_MS);

      let result: E3RunResult;
      try {
        result = await runE3Cell(anvilConfig, cell, T, cellSeed);
      } finally {
        clearInterval(rssTimer);
      }

      const peakRssMb = anvil.peakRssBytes() / (1024 * 1024);
      if (peakRssMb > peakRssOverall) peakRssOverall = peakRssMb;
      await anvil.stop();
      const runTotalMs = Number(process.hrtime.bigint() - tRunStart) / 1e6;
      overheads.push({ bootMs: anvil.bootMs, fundMs: anvil.fundMs, totalMs: runTotalMs - result.durationMs });

      console.log(
        `[e3_throughput] rep=${r} ${cellId} done: ops_completed=${result.opsCompleted} ops_failed=${result.opsFailed} ops_retried=${result.opsRetried} duration_ms=${result.durationMs.toFixed(1)} ` +
          `| anvil boot=${anvil.bootMs.toFixed(0)}ms fund=${anvil.fundMs.toFixed(0)}ms overhead=${(runTotalMs - result.durationMs).toFixed(0)}ms peak_rss=${peakRssMb.toFixed(0)}MB`
      );

      // Memory guard: stop on purpose, with a recorded reason, rather than
      // letting the kernel kill the node mid-write (which is what
      // truncated the previous attempt's file).
      if (guardTripped !== null || peakRssMb > ANVIL_MAX_RSS_MB) {
        const rssMb = guardTripped?.rssMb ?? peakRssMb;
        writer.write({
          run_id: runId,
          cell_id: cellId,
          repetition: r,
          seed: cellSeed,
          started_at: startedAt,
          duration_ms: 0,
          layer: "L2",
          function: "transferUtxoBatch",
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
          status: "aborted_memory_guard",
          notes:
            `anvil RSS ${rssMb.toFixed(0)}MB melewati ambang ${ANVIL_MAX_RSS_MB}MB (E3_ANVIL_MAX_RSS_MB); ` +
            `kampanye dihentikan sengaja sebelum OOM killer. Pengukuran run ini TIDAK dipakai.`,
          env_hash: envHash,
          setup_tx_count: null,
          test_name: null,
          assert_result: null,
        });
        console.error(
          `[e3_throughput] BERHENTI: anvil RSS ${rssMb.toFixed(0)}MB > ambang ${ANVIL_MAX_RSS_MB}MB pada ${cellId} rep=${r}. ` +
            `Record berstatus aborted_memory_guard sudah ditulis; hasil sejauh ini utuh di ${writer.path}. ` +
            `Lanjutkan dengan --resume setelah penyebabnya jelas.`
        );
        process.exit(1);
      }

      const record: BenchRecord = {
        run_id: runId,
        cell_id: cellId,
        repetition: r,
        seed: cellSeed,
        started_at: startedAt,
        duration_ms: result.durationMs,
        layer: "L2",
        function: "transferUtxoBatch",
        n_elements: null,
        gas_used: null,
        gas_limit: null,
        calldata_bytes: null,
        calldata_zero_bytes: null,
        calldata_nonzero_bytes: null,
        tx_count: Math.ceil(T / B),
        tx_hash: null,
        block_number: null,
        ops_completed: result.opsCompleted,
        ops_failed: result.opsFailed,
        ops_retried: result.opsRetried,
        latency_ms: result.latencyMs,
        status: result.opsFailed > 0 ? "error" : "ok",
        notes:
          result.timeoutEvents.length > 0
            ? `batch_timeout after ${BATCH_TIMEOUT_MS}ms on ${result.timeoutEvents.length} batch(es): ${result.timeoutEvents
                .map((e) => `batch#${e.batchIdx}=${e.hash}`)
                .join(", ")}`
            : null,
        env_hash: envHash,
        setup_tx_count: null,
        test_name: null,
        assert_result: null,
      };
      writer.write(record);
    }
  }

  if (overheads.length > 0) {
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const boot = overheads.map((o) => o.bootMs);
    const fund = overheads.map((o) => o.fundMs);
    const total = overheads.map((o) => o.totalMs);
    const mean = (xs: number[]) => sum(xs) / xs.length;
    console.log(
      `[e3_throughput] overhead penyiapan per run (n=${overheads.length}): ` +
        `anvil boot ${mean(boot).toFixed(0)}ms, pendanaan ${mean(fund).toFixed(0)}ms, ` +
        `total di luar jendela ukur ${mean(total).toFixed(0)}ms (min ${Math.min(...total).toFixed(0)}, max ${Math.max(...total).toFixed(0)}). ` +
        `Peak RSS anvil tertinggi: ${peakRssOverall.toFixed(0)}MB (ambang ${ANVIL_MAX_RSS_MB}MB).`
    );
    console.log(
      `[e3_throughput] ekstrapolasi 600 run: overhead ~${((mean(total) * 600) / 60000).toFixed(1)} menit total.`
    );
  }

  if (RESUME) {
    console.log(
      `[resume] E3: ${resumeSkipped} sel sudah ada dan dilewati; ${resumeRan} dikerjakan sekarang ` +
        `(${writer.resumedRecordCount} record lama tidak disentuh).`
    );
  }
  console.log(`[e3_throughput] output -> ${writer.path}`);
  const lines = readFileSync(writer.path, "utf8").trim().split("\n");
  console.log(`\n[e3_throughput] sample JSONL lines (${lines.length} total):`);
  for (const line of lines.slice(0, 5)) console.log(line);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
