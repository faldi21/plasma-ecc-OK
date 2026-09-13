/**
 * Deterministic test-account generation, per docs/EXPERIMENT_PRD.md §3.4's
 * general determinism rule ("Tidak ada Math.random() tanpa seed" --
 * CLAUDE.md): every account used in a benchmark run must be derivable
 * from a recorded seed, not created ad-hoc.
 */
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, type Hex } from "viem";
import { randomBigInt } from "./rng.js";

/** Derives a deterministic private key from a seed and an index. */
export function deriveAccountKey(seed: number, index: number): Hex {
  const material = toHex(`plasma-bench-account:${seed}:${index}`);
  return keccak256(material);
}

/** Derives K deterministic accounts from a seed. */
export function deriveAccounts(seed: number, k: number) {
  const accounts = [];
  for (let i = 0; i < k; i++) {
    const pk = deriveAccountKey(seed, i);
    accounts.push(privateKeyToAccount(pk));
  }
  return accounts;
}

/** The operator account, from OPERATOR_PRIVATE_KEY / L2_OPERATOR_PRIVATE_KEY in .env. */
export function loadOperatorPrivateKey(): Hex {
  const pk = process.env.L2_OPERATOR_PRIVATE_KEY || process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) {
    throw new Error("L2_OPERATOR_PRIVATE_KEY or OPERATOR_PRIVATE_KEY must be set in .env");
  }
  return pk as Hex;
}

/** Deterministic bytes32 element ids (e.g. UTXO ids) for a given seed. */
export function deriveElementIds(seed: number, n: number): Hex[] {
  const ids: Hex[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(keccak256(toHex(`plasma-bench-element:${seed}:${i}`)));
  }
  return ids;
}

export { randomBigInt };
