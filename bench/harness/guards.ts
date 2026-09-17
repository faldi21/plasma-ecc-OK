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

/**
 * The RUN_ID for this run, from `--run-id <id>` if given, otherwise the
 * RUN_ID environment variable. Never invents one.
 *
 * The flag really is read here. It used to be ignored -- only the env var
 * was consulted -- while the error message said "--run-id wajib", so
 * passing exactly what the message asked for changed nothing and the
 * failure looked inexplicable. Makefile.paper1 passes the flag AND
 * exports the variable, which is why the gap stayed hidden for so long.
 */
export function requireRunId(argv: string[] = process.argv): string {
  const idx = argv.indexOf("--run-id");
  const fromFlag = idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  const runId = fromFlag || process.env.RUN_ID;
  if (!runId) {
    console.error(
      "FATAL: RUN_ID belum ditentukan. Pakai salah satu:\n" +
        "  - argumen: --run-id <RUN_ID>\n" +
        "  - variabel lingkungan: RUN_ID=<RUN_ID>\n" +
        "Argumen diutamakan kalau keduanya ada. Jalankan `make freeze` dulu kalau belum punya RUN_ID " +
        "(RUN_ID terakhir ada di data/LATEST)."
    );
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
