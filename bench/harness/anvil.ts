/**
 * Anvil connection + snapshot/revert isolation, per docs/EXPERIMENT_PRD.md
 * §3.3: every run measures from an identical starting state (evm_snapshot
 * before, evm_revert after), so cold/warm storage-slot status never
 * differs between variants for reasons unrelated to the thing being
 * measured.
 */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface AnvilConfig {
  rpcUrl: string;
  chainId: number;
}

export function loadAnvilConfig(): AnvilConfig {
  const rpcUrl = process.env.L2_RPC_URL || `http://127.0.0.1:${process.env.ANVIL_PORT || "8546"}`;
  return { rpcUrl, chainId: 31337 };
}

// viem's default pollingInterval (4_000ms, meant for real chains with real
// block times) was silently inflating every waitForTransactionReceipt() on
// Anvil -- which mines instantly -- to a flat ~4s regardless of the actual
// receipt already being available (pre-freeze harness fix, CACAT 4). The
// timeout is also raised well past viem's 60s default: a heavy cell's
// eth_estimateGas (e.g. sys.plasma_eccmath at large n) can legitimately
// take longer than that to simulate against a 300M-gas block (CACAT 3).
const ANVIL_POLLING_INTERVAL_MS = 50;
const ANVIL_RPC_TIMEOUT_MS = 180_000;

export function makeClients(cfg: AnvilConfig, operatorPrivateKey: Hex) {
  const chain = {
    id: cfg.chainId,
    name: "Plasma L2 Bench",
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrls: { default: { http: [cfg.rpcUrl] }, public: { http: [cfg.rpcUrl] } },
  } as const;

  const publicClient = createPublicClient({
    chain,
    transport: http(cfg.rpcUrl, { timeout: ANVIL_RPC_TIMEOUT_MS }),
    pollingInterval: ANVIL_POLLING_INTERVAL_MS,
  });
  const operatorAccount = privateKeyToAccount(operatorPrivateKey);
  const operatorWalletClient = createWalletClient({
    account: operatorAccount,
    chain,
    transport: http(cfg.rpcUrl, { timeout: ANVIL_RPC_TIMEOUT_MS }),
  });

  return { chain, publicClient, operatorAccount, operatorWalletClient };
}

/** Takes an EVM snapshot, returns its id. */
export async function snapshot(publicClient: ReturnType<typeof makeClients>["publicClient"]): Promise<Hex> {
  return (await publicClient.request({ method: "evm_snapshot" as any, params: [] as any })) as Hex;
}

/** Reverts to a previously taken snapshot. */
export async function revert(
  publicClient: ReturnType<typeof makeClients>["publicClient"],
  id: Hex
): Promise<void> {
  await publicClient.request({ method: "evm_revert" as any, params: [id] as any });
}

/** Funds an address with the given amount (wei), Anvil-only cheat. */
export async function setBalance(
  publicClient: ReturnType<typeof makeClients>["publicClient"],
  address: `0x${string}`,
  weiHex: Hex
): Promise<void> {
  await publicClient.request({ method: "anvil_setBalance" as any, params: [address, weiHex] as any });
}
