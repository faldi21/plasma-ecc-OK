/**
 * Deterministic PRNG and seeded shuffle, per docs/EXPERIMENT_PRD.md §3.4
 * (R1-6, R2-M8): cell order must be randomized per repetition, with the
 * seed recorded so the exact sequence can be reconstructed later. This is
 * what eliminates the non-monotonic drift the reviewers flagged in the
 * original manuscript (2,000; 2,000; 2,373; 2,294 -- suspected to be
 * order/time-of-day effects, not real measurement).
 */

/**
 * Derives a deterministic per-repetition seed from a campaign-level base
 * seed and the repetition index. Same base seed + same r always produces
 * the same cell order -- this is what "seed tercatat" (§3.4) makes
 * reproducible.
 */
export function seedFor(baseSeed: number, r: number): number {
  // Simple, deterministic mixing (not cryptographic -- doesn't need to be,
  // this only needs to be reproducible and well-distributed enough to
  // avoid accidental correlation between repetitions).
  let h = (baseSeed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ r, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/**
 * mulberry32: small, fast, deterministic PRNG. Not cryptographically
 * secure -- not needed here, this only drives cell-order shuffling and
 * synthetic test-data generation, never anything security-relevant.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle, seeded. */
export function shuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Deterministic random uint256-range bigint (bounded by 256 bits), seeded. */
export function randomBigInt(seed: number): bigint {
  const rand = mulberry32(seed);
  let hex = "0x";
  for (let i = 0; i < 8; i++) {
    hex += Math.floor(rand() * 0x100000000)
      .toString(16)
      .padStart(8, "0");
  }
  return BigInt(hex);
}
