/**
 * Resilient L1 (Sepolia) transaction sending.
 *
 * E2's L1 phase died after ~3 hours on a single
 * WaitForTransactionReceiptTimeoutError. The transaction behind it was
 * checked afterwards with `cast tx` and had an empty blockHash/blockNumber:
 * it had been DROPPED from the mempool, most likely left behind when the
 * base fee rose. viem's waitForTransactionReceipt cannot recover from that
 * by design -- it waits for a hash that no longer exists anywhere -- so the
 * whole campaign went down with it.
 *
 * What this module does instead, per transaction:
 *   1. Pin an explicit nonce and send with a real margin over the CURRENT
 *      base fee (base * BASE_FEE_MULTIPLIER + tip), so the common case
 *      does not get stranded when the base fee climbs.
 *   2. Wait up to CONFIRM_BUDGET_MS, polling for either a receipt (mined:
 *      done) or evidence the transaction is still known to the node
 *      (pending: keep waiting).
 *   3. If the node stops knowing the hash at all -- no receipt AND no
 *      transaction -- for DROP_CONFIRMATIONS consecutive polls, treat it as
 *      dropped and re-send IMMEDIATELY at the SAME nonce with fees bumped
 *      from the network price at that moment (not from the stale ones that
 *      just failed). Same if the budget runs out while it is still pending:
 *      a transaction that has sat for that long is underpriced.
 *   4. "replacement transaction underpriced" is expected here and handled
 *      by bumping again rather than giving up.
 *   5. After MAX_RESENDS re-sends, give up on THIS transaction only, by
 *      throwing L1ConfirmFailedError. The caller records a "timeout" record
 *      and moves to the next cell -- the campaign does not die.
 *   6. Every RPC call above goes through withNetworkRetry(), which retries
 *      TRANSPORT failures (EAI_AGAIN, ECONNRESET, ETIMEDOUT, "fetch
 *      failed", ...) with exponential backoff for up to
 *      NETWORK_RETRY_BUDGET_MS. E2 also died once on exactly this: a
 *      momentary DNS hiccup while asking for a receipt became an unhandled
 *      rejection. Errors the node actually answered with (revert,
 *      underpriced, nonce) are never retried -- they are decisions, not
 *      dropped packets, and are rethrown on the first try.
 *
 * gas_used is never invented for a transaction with no receipt: callers
 * that catch L1ConfirmFailedError write gas_used: null (CLAUDE.md IRON
 * RULE 1).
 */
import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Account,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";

/** One Sepolia block is ~12s; 20 minutes is ~100 blocks of patience. */
export const CONFIRM_BUDGET_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;
/** Consecutive "node knows nothing about this hash" polls before declaring a drop. */
const DROP_CONFIRMATIONS = 3;
/** Ticket: "kirim ulang dengan fee lebih tinggi, maksimal 3 kali". */
export const MAX_RESENDS = 3;
/** maxFeePerGas = baseFee * this + tip: survives several consecutive full blocks. */
const BASE_FEE_MULTIPLIER = 3n;
/** Minimum tip, and the floor a bump must clear (geth wants >= +10%; 25% leaves room). */
const MIN_TIP_WEI = 1_500_000_000n; // 1.5 gwei
const BUMP_NUMERATOR = 125n;
const BUMP_DENOMINATOR = 100n;
/** Guard against an unbounded bump loop when a node keeps saying "underpriced". */
const MAX_UNDERPRICED_BUMPS = 4;

/** Total time a single RPC call may spend being retried through transient network trouble. */
export const NETWORK_RETRY_BUDGET_MS = 5 * 60 * 1000;
const RETRY_BACKOFF_START_MS = 1_000;
const RETRY_BACKOFF_CAP_MS = 30_000;

/**
 * Transport-level failures: the request never got a considered answer, so
 * asking again is both safe and likely to work. E2 died on the first of
 * these -- a momentary DNS hiccup (getaddrinfo EAI_AGAIN) while polling
 * for a receipt -- which surfaced as an unhandled rejection and took the
 * whole campaign with it.
 */
const TRANSIENT_MARKERS = [
  "eai_again",
  "econnreset",
  "etimedout",
  "enotfound",
  "epipe",
  "fetch failed",
  "socket hang up",
  "network socket disconnected",
];

/**
 * Answers the node DID consider. Retrying these changes nothing (the node
 * will say the same thing) and, for a send, could duplicate work -- so
 * they must break out of the retry loop immediately and be handled by the
 * caller's own logic (fee bump, "timeout" record, ...).
 */
const PROTOCOL_MARKERS = [
  "execution reverted",
  "insufficient funds",
  "nonce too low",
  "nonce too high",
  "already known",
  "replacement transaction underpriced",
  "replacement fee too low",
  "intrinsic gas too low",
  "exceeds block gas limit",
  "gas required exceeds",
  "transaction creation failed",
];

function errorText(err: unknown): string {
  const e = err as { message?: string; details?: string; shortMessage?: string; cause?: unknown };
  const parts = [e?.message, e?.details, e?.shortMessage];
  const cause = e?.cause as { message?: string; details?: string } | undefined;
  if (cause) parts.push(cause.message, cause.details);
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/** True only for transport failures, never for an answer the node actually gave. */
export function isTransientNetworkError(err: unknown): boolean {
  const text = errorText(err);
  if (PROTOCOL_MARKERS.some((m) => text.includes(m))) return false;
  return TRANSIENT_MARKERS.some((m) => text.includes(m));
}

/**
 * Runs one RPC call, retrying transient network failures with exponential
 * backoff until NETWORK_RETRY_BUDGET_MS is spent, then rethrowing. A
 * protocol error is rethrown immediately, on the first try.
 */
export async function withNetworkRetry<T>(
  label: string,
  fn: () => Promise<T>,
  budgetMs: number = NETWORK_RETRY_BUDGET_MS
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  let delay = RETRY_BACKOFF_START_MS;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      if (!isTransientNetworkError(err)) throw err;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        console.error(
          `[l1tx] ${label}: masih gagal jaringan setelah ${attempt} percobaan / ` +
            `${(budgetMs / 60000).toFixed(1)} menit -- menyerah.`
        );
        throw err;
      }
      const wait = Math.min(delay, Math.max(remaining, 0));
      console.warn(
        `[l1tx] ${label}: galat jaringan sementara (${String((err as Error).message).split("\n")[0].slice(0, 120)}); ` +
          `coba lagi dalam ${(wait / 1000).toFixed(1)}s (percobaan ${attempt}, sisa anggaran ${(remaining / 1000).toFixed(0)}s)`
      );
      await sleep(wait);
      delay = Math.min(delay * 2, RETRY_BACKOFF_CAP_MS);
    }
  }
}

export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface L1SendOutcome {
  /** Hash of the attempt that actually produced the receipt. */
  hash: Hex;
  receipt: TransactionReceipt;
  /** 0 when the first send confirmed; otherwise how many re-sends it took. */
  resends: number;
  /** Non-null only when a re-send happened -- goes into the record's notes. */
  notes: string | null;
}

export class L1ConfirmFailedError extends Error {
  constructor(
    readonly label: string,
    readonly hashes: Hex[],
    readonly lastFees: Fees
  ) {
    super(
      `${label}: no receipt after ${hashes.length} send attempt(s) (${CONFIRM_BUDGET_MS / 60000} min each). ` +
        `Hashes tried: ${hashes.join(", ")}`
    );
    this.name = "L1ConfirmFailedError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isReplacementUnderpriced(err: unknown): boolean {
  const text = `${(err as Error)?.message ?? ""} ${String((err as { details?: string })?.details ?? "")}`.toLowerCase();
  return text.includes("replacement transaction underpriced") || text.includes("replacement fee too low");
}

function bump(value: bigint): bigint {
  return (value * BUMP_NUMERATOR) / BUMP_DENOMINATOR + 1n;
}

/** Fees derived from the network RIGHT NOW, with a margin over the current base fee. */
export async function currentFees(publicClient: PublicClient): Promise<Fees> {
  const block = await withNetworkRetry("getBlock(latest)", () => publicClient.getBlock({ blockTag: "latest" }));
  const baseFee = block.baseFeePerGas ?? 0n;
  let tip = MIN_TIP_WEI;
  try {
    const suggested = await withNetworkRetry("estimateMaxPriorityFeePerGas", () =>
      publicClient.estimateMaxPriorityFeePerGas()
    );
    if (suggested > tip) tip = suggested;
  } catch {
    // Node without eth_maxPriorityFeePerGas: MIN_TIP_WEI is the floor anyway.
  }
  return { maxFeePerGas: baseFee * BASE_FEE_MULTIPLIER + tip, maxPriorityFeePerGas: tip };
}

/** Never lower than a 25% bump on the fees that just failed, never lower than the network now. */
async function bumpedFees(publicClient: PublicClient, previous: Fees): Promise<Fees> {
  const now = await currentFees(publicClient);
  const maxPriorityFeePerGas =
    now.maxPriorityFeePerGas > bump(previous.maxPriorityFeePerGas)
      ? now.maxPriorityFeePerGas
      : bump(previous.maxPriorityFeePerGas);
  const floor = bump(previous.maxFeePerGas);
  const fromNetwork = now.maxFeePerGas + maxPriorityFeePerGas;
  return { maxFeePerGas: fromNetwork > floor ? fromNetwork : floor, maxPriorityFeePerGas };
}

type WaitOutcome =
  | { kind: "receipt"; receipt: TransactionReceipt }
  | { kind: "dropped" }
  | { kind: "pending_budget_exhausted" };

async function waitForReceiptOrDrop(publicClient: PublicClient, hash: Hex, budgetMs: number): Promise<WaitOutcome> {
  const deadline = Date.now() + budgetMs;
  let unknownPolls = 0;

  while (Date.now() < deadline) {
    try {
      return {
        kind: "receipt",
        receipt: await withNetworkRetry(`getTransactionReceipt(${hash.slice(0, 10)}...)`, () =>
          publicClient.getTransactionReceipt({ hash })
        ),
      };
    } catch (err) {
      if (!(err instanceof TransactionReceiptNotFoundError)) throw err;
    }

    // No receipt yet. Is the transaction still known to the node at all?
    try {
      await withNetworkRetry(`getTransaction(${hash.slice(0, 10)}...)`, () => publicClient.getTransaction({ hash }));
      unknownPolls = 0; // still in the mempool (or just mined) -- keep waiting
    } catch (err) {
      if (!(err instanceof TransactionNotFoundError)) throw err;
      unknownPolls += 1;
      // Several consecutive misses, not one: a node can briefly not know a
      // hash it has just accepted, and one unlucky poll must not be enough
      // to declare a perfectly good transaction dead.
      if (unknownPolls >= DROP_CONFIRMATIONS) return { kind: "dropped" };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return { kind: "pending_budget_exhausted" };
}

/**
 * Sends one L1 transaction and returns its receipt, re-sending at the same
 * nonce with higher fees if it is dropped or stalls. `send` receives the
 * fee/nonce overrides to apply and must perform exactly one send.
 */
export async function sendL1WithRetry(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Account,
  label: string,
  send: (overrides: Fees & { nonce: number }) => Promise<Hex>,
  budgetMs: number = CONFIRM_BUDGET_MS
): Promise<L1SendOutcome> {
  const nonce = await withNetworkRetry(`${label}: getTransactionCount`, () =>
    publicClient.getTransactionCount({ address: account.address, blockTag: "pending" })
  );
  let fees = await currentFees(publicClient);
  const hashes: Hex[] = [];
  const reasons: string[] = [];

  for (let attempt = 0; attempt <= MAX_RESENDS; attempt++) {
    let hash: Hex | null = null;
    for (let bumpTry = 0; bumpTry <= MAX_UNDERPRICED_BUMPS; bumpTry++) {
      try {
        hash = await withNetworkRetry(`${label}: send (nonce ${nonce})`, () => send({ ...fees, nonce }));
        break;
      } catch (err) {
        if (!isReplacementUnderpriced(err) || bumpTry === MAX_UNDERPRICED_BUMPS) throw err;
        fees = { maxFeePerGas: bump(fees.maxFeePerGas), maxPriorityFeePerGas: bump(fees.maxPriorityFeePerGas) };
        reasons.push(`replacement underpriced -> bumped to maxFee=${fees.maxFeePerGas}`);
      }
    }
    if (hash === null) throw new Error(`${label}: send() returned no hash`);
    hashes.push(hash);

    const outcome = await waitForReceiptOrDrop(publicClient, hash, budgetMs);
    if (outcome.kind === "receipt") {
      return {
        hash,
        receipt: outcome.receipt,
        resends: attempt,
        notes:
          attempt === 0
            ? null
            : `resent ${attempt}x at nonce ${nonce} before confirming (${reasons.join("; ")}); earlier hashes: ${hashes
                .slice(0, -1)
                .join(", ")}`,
      };
    }

    if (attempt === MAX_RESENDS) break;

    reasons.push(
      outcome.kind === "dropped"
        ? `${hash} dropped from mempool (no receipt, no transaction)`
        : `${hash} still pending after ${budgetMs / 60000} min`
    );
    fees = await bumpedFees(publicClient, fees);
    console.warn(
      `[l1tx] ${label}: ${reasons[reasons.length - 1]}; re-sending at nonce ${nonce} with ` +
        `maxFee=${fees.maxFeePerGas} tip=${fees.maxPriorityFeePerGas} (attempt ${attempt + 2}/${MAX_RESENDS + 1})`
    );
  }

  throw new L1ConfirmFailedError(label, hashes, fees);
}
