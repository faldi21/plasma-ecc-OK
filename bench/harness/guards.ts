/**
 * Pre-flight guards run before any cell (pre-freeze harness hardening):
 * a missing RUN_ID used to fall back to an auto-generated timestamp, which
 * let one campaign silently produce several differently-identified
 * datasets across E1-E4 runs if a script was ever launched without
 * --run-id/RUN_ID set. An unreachable RPC used to fail mid-run with a
 * multi-screen viem fetch-failed stack trace instead of one clear line.
 * Both fail fast with a single message and process.exit(1) -- never a
 * guess, never a partial write to data/.
 */
import { createPublicClient, http } from "viem";

/** Exits the process if RUN_ID isn't set in the environment -- never invents one. */
export function requireRunId(): string {
  const runId = process.env.RUN_ID;
  if (!runId) {
    console.error("FATAL: --run-id wajib. Jalankan `make freeze` dulu, lalu export RUN_ID.");
    process.exit(1);
  }
  return runId;
}

/** Exits the process if rpcUrl doesn't answer eth_chainId within timeoutMs. */
export async function assertRpcReachable(rpcUrl: string, timeoutMs = 5_000): Promise<void> {
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: timeoutMs }) });
  try {
    await client.request({ method: "eth_chainId", params: [] });
  } catch {
    console.error(`FATAL: RPC ${rpcUrl} tidak bisa dihubungi. Jalankan \`make anvil\` dulu.`);
    process.exit(1);
  }
}
