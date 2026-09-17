/**
 * One fresh Anvil per measured run (ANALYSIS_PLAN.md Amandemen 2).
 *
 * E3 used to run all 600 runs against a single long-lived Anvil. The chain
 * grew monotonically until the OOM killer took the node at run 17 of 600
 * on a 13 GB machine, after ~54 GB of Anvil state had accumulated on disk.
 * Memory was only the visible half of the problem: chain size is a
 * CONFOUND. A cell scheduled late was measured on a much larger chain and
 * a much more loaded node, so its throughput fell because of its position
 * in the queue rather than because of the primitive being compared.
 *
 * So: start a node, fund, deploy, measure, kill the node, delete its
 * state. Every run begins from an identical chain, and chain size stops
 * being a variable at all.
 *
 * The anvil flags here are EXACTLY the ones Makefile.paper1's p1-anvil
 * target uses (--port, --gas-limit, --chain-id 31337) -- they are part of
 * the measured environment and are recorded in manifest.json. Per-run
 * state isolation is done with FOUNDRY_HOME pointed at a temp directory,
 * NOT by adding a flag, precisely so the flag list stays byte-identical.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 200;
const STOP_GRACE_MS = 5_000;

/**
 * Anvil's own default account #0, from the published "test test ... junk"
 * mnemonic every Anvil ships with. Local-only, holds nothing real, and is
 * the funding source scripts/anvil_paper1.sh already uses -- same
 * procedure here so the in-process path and the make target cannot drift.
 */
const ANVIL_ACCOUNT0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

export interface AnvilHandle {
  rpcUrl: string;
  pid: number;
  /** Temp FOUNDRY_HOME for this run; deleted by stop(). */
  stateDir: string;
  /** Wall-clock ms from spawn to the first successful eth_blockNumber. */
  bootMs: number;
  /** Wall-clock ms spent funding harness accounts. */
  fundMs: number;
  /** Current RSS of the anvil process in bytes, or null if it is gone. */
  rssBytes(): number | null;
  /** Highest RSS seen so far, in bytes. */
  peakRssBytes(): number;
  /** Kills anvil and removes its state directory. Safe to call twice. */
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** RSS from /proc, cheap enough to sample during a measured window. */
function readRss(pid: number): number | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const m = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    return m ? parseInt(m[1], 10) * 1024 : null;
  } catch {
    return null; // process gone
  }
}

/** True if something already answers on this port (a stray `make anvil`). */
async function portInUse(rpcUrl: string): Promise<boolean> {
  const probe = createPublicClient({ transport: http(rpcUrl, { timeout: 1_000, retryCount: 0 }) });
  try {
    await probe.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

export interface StartAnvilOptions {
  port: number;
  gasLimit: string;
  /** Keys to fund; duplicates by address are funded once. */
  fundKeys: Hex[];
  fundEth: string;
}

export async function startFreshAnvil(opts: StartAnvilOptions): Promise<AnvilHandle> {
  const rpcUrl = `http://127.0.0.1:${opts.port}`;

  if (await portInUse(rpcUrl)) {
    throw new Error(
      `port ${opts.port} already has a node answering on it. E3 now starts and stops its own Anvil per run ` +
        `(ANALYSIS_PLAN.md Amandemen 2), so a separately started \`make anvil\` must be stopped first.`
    );
  }

  const stateDir = mkdtempSync(path.join(tmpdir(), "e3-anvil-"));
  const t0 = process.hrtime.bigint();

  const child: ChildProcess = spawn(
    "anvil",
    ["--port", String(opts.port), "--gas-limit", opts.gasLimit, "--chain-id", "31337"],
    { env: { ...process.env, FOUNDRY_HOME: stateDir }, stdio: "ignore", detached: false }
  );
  const pid = child.pid!;
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  let peakRss = 0;
  const sample = () => {
    const rss = readRss(pid);
    if (rss !== null && rss > peakRss) peakRss = rss;
    return rss;
  };

  const cleanup = () => {
    try {
      rmSync(stateDir, { recursive: true, force: true });
    } catch {
      /* best effort: a temp dir left behind must never fail a campaign */
    }
  };

  const stop = async (): Promise<void> => {
    if (!exited) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      const deadline = Date.now() + STOP_GRACE_MS;
      while (!exited && Date.now() < deadline) await sleep(50);
      if (!exited) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        while (!exited && Date.now() < deadline + STOP_GRACE_MS) await sleep(50);
      }
    }
    cleanup();
  };

  // Readiness by polling eth_blockNumber, never by sleeping a guess.
  const probe = createPublicClient({ transport: http(rpcUrl, { timeout: 1_000, retryCount: 0 }) });
  const readyDeadline = Date.now() + READY_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < readyDeadline) {
    if (exited) {
      cleanup();
      throw new Error(`anvil exited before its RPC came up (port ${opts.port})`);
    }
    try {
      await probe.getBlockNumber();
      ready = true;
      break;
    } catch {
      await sleep(READY_POLL_MS);
    }
  }
  if (!ready) {
    await stop();
    throw new Error(`anvil RPC not ready within ${READY_TIMEOUT_MS / 1000}s on port ${opts.port}`);
  }
  const bootMs = Number(process.hrtime.bigint() - t0) / 1e6;

  // Fund the harness accounts from Anvil's default account #0, matching
  // scripts/anvil_paper1.sh. Anvil funds only its own accounts; the
  // operator key from .env is one it has never heard of, and without this
  // the first deploy fails at eth_estimateGas.
  const tFund = process.hrtime.bigint();
  const chain = {
    id: 31337,
    name: "Plasma L2 Bench",
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  } as const;
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 50 });
  const funder = privateKeyToAccount(ANVIL_ACCOUNT0_KEY);
  const funderClient = createWalletClient({ account: funder, chain, transport: http(rpcUrl) });

  const targets = [...new Set(opts.fundKeys.map((pk) => privateKeyToAccount(pk).address))];
  const amountWei = parseEther(opts.fundEth);
  // Account #0 starts with exactly 10000 ETH and so cannot transfer a full
  // 10000 ETH; top the FUNDER up first. The cheat touches only the funding
  // account, never a measured one, and every target still receives a real
  // transfer.
  await publicClient.request({
    method: "anvil_setBalance" as any,
    params: [funder.address, `0x${(amountWei * BigInt(targets.length + 1)).toString(16)}`] as any,
  });
  for (const to of targets) {
    const hash = await funderClient.sendTransaction({ to, value: amountWei, account: funder, chain });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  const fundMs = Number(process.hrtime.bigint() - tFund) / 1e6;

  sample();
  return {
    rpcUrl,
    pid,
    stateDir,
    bootMs,
    fundMs,
    rssBytes: sample,
    peakRssBytes: () => peakRss,
    stop,
  };
}
