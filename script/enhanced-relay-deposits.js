import { ethers, NonceManager } from "ethers";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import  axios  from "axios";
// --- Setup path dan load .env ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath });

// Use axios instead of fetch for better CommonJS compatibility
//const axios = require('axios');

//const { ethers, NonceManager } = require("ethers");

// ===== ENV =====
const {
  SEPOLIA_RPC_URL,
  SEPOLIA_WSS_URL,
  L2_RPC_URL,
  ROOT_CHAIN_ADDRESS,
  L2_PLASMA_CHAIN_ADDRESS,
  L2_OPERATOR_PRIVATE_KEY,
  OPERATOR_PRIVATE_KEY,
  L1_FROM_BLOCK,
  PLASMA_TOKEN_ADDRESS,
  L2_PLASMA_TOKEN_ADDRESS,
} = process.env;

// L2 API endpoint
const L2_API_URL = process.env.L2_API_URL || 'http://localhost:3001';

// ===== ABIs minimal =====
const rootAbi = [
  "event Deposit(address indexed user, address indexed token, uint256 amount)",
  "function submitBlock(tuple(uint256 x, uint256 y) accumulatorValue, uint256 transactionCount, bytes32[] transactionHashes) external",
  "function currentPlasmaBlock() view returns (uint256)",
];
const plasmaAbi = [
  "function updateBalance(address user, address token, uint256 amount) external",
  "function getBalance(address user, address token) view returns (uint256)",
];
const tokenAbi = [
  "function mint(address to, uint256 amount) external",
  "function owner() view returns (address)"
];

// ===== Providers & Contracts =====
let l1;
if (SEPOLIA_WSS_URL && SEPOLIA_WSS_URL.trim()) {
  console.log("[L1] Using WebSocketProvider:", SEPOLIA_WSS_URL);
  l1 = new ethers.WebSocketProvider(SEPOLIA_WSS_URL);
} else {
  console.log("[L1] Using JsonRpcProvider (HTTP):", SEPOLIA_RPC_URL);
  l1 = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
  l1.pollingInterval = 1500; // ms
}

const l2 = new ethers.JsonRpcProvider(L2_RPC_URL);

// L1 contracts (read-only)
const root = new ethers.Contract(ROOT_CHAIN_ADDRESS, rootAbi, l1);

// L1 operator for block submission
const l1OperatorSigner = new ethers.Wallet(OPERATOR_PRIVATE_KEY, l1);
const rootWithOperator = new ethers.Contract(ROOT_CHAIN_ADDRESS, rootAbi, l1OperatorSigner);

const operator = new ethers.Wallet(L2_OPERATOR_PRIVATE_KEY, l2);
//const operator = new NonceManager(baseSigner);

const plasma = new ethers.Contract(L2_PLASMA_CHAIN_ADDRESS, plasmaAbi, operator);
const tokenAsOwner = L2_PLASMA_TOKEN_ADDRESS
  ? new ethers.Contract(L2_PLASMA_TOKEN_ADDRESS, tokenAbi, operator)
  : null;

// ===== State (dedup & lastBlock) =====
const STATE_FILE = path.resolve(process.cwd(), ".relay_state.json");
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { lastBlock: Number(L1_FROM_BLOCK || 0), processed: [] }; }
}

function saveState(s) {
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, STATE_FILE);
}

const state = loadState();
const processed = new Set(state.processed || []);

function remember(key) {
  processed.add(key);
  state.processed = Array.from(processed).slice(-2000);
  saveState(state);
}

// ===== Transaction counter for L1→L2 relay block creation =====
let relayTransactionsSinceLastBlock = 0;
const RELAY_TRANSACTIONS_PER_BLOCK = 10; // Create block every 10 relay transactions
const RELAY_BLOCK_TIMEOUT = 60000; // Or create block every 60 seconds for relay transactions
let lastRelayBlockTime = Date.now();

// ===== Track relay transaction hashes for L1 submission =====
let relayTransactionHashes = [];

// ===== Helpers =====
function mapL1ToL2Token(l1TokenAddr) {
  if (!l1TokenAddr) return null;
  if (PLASMA_TOKEN_ADDRESS && L2_PLASMA_TOKEN_ADDRESS &&
      l1TokenAddr.toLowerCase() === PLASMA_TOKEN_ADDRESS.toLowerCase()) {
    return L2_PLASMA_TOKEN_ADDRESS;
  }
  return l1TokenAddr;
}

async function maybeMint(user, l2Token, amount) {
  if (!tokenAsOwner) { 
    console.log("  ℹ Skip mint: L2_PLASMA_TOKEN_ADDRESS belum diset"); 
    return; 
  }
  if (!user || !l2Token || amount == null) {
    console.log("  ℹ Skip mint: parameter tidak lengkap", { user, l2Token, amount: String(amount || 0) });
    return;
  }
  const sameToken = L2_PLASMA_TOKEN_ADDRESS &&
                    l2Token &&
                    (L2_PLASMA_TOKEN_ADDRESS.toLowerCase() === l2Token.toLowerCase());
  if (!sameToken) {
    console.log(`  ℹ Skip mint: l2Token(${l2Token}) != L2_PLASMA_TOKEN_ADDRESS(${L2_PLASMA_TOKEN_ADDRESS})`);
    return;
  }
  try {
    const m = await tokenAsOwner.mint(user, amount);
    const mr = await m.wait();
    console.log(`  ✔ L2 mint ERC20 tx: ${mr.hash}`);
  } catch (e) {
    console.error("  ✖ Mint failed:", e?.info?.error || e?.error || e);
  }
}

// ===== L1 Block submission =====
async function submitBlockToL1(blockData) {
  try {
    console.log(`\n🚀 Submitting block ${blockData.blockNumber} to L1...`);

    // Get all transaction hashes: relay + backend
    let allTransactionHashes = [...relayTransactionHashes];

    // Try to get backend transaction hashes if this block includes backend transactions
    if (blockData.transactionCount > relayTransactionHashes.length) {
      console.log(`  📋 Block includes backend transactions, fetching all hashes...`);
      try {
        const pendingResponse = await axios.get(`${L2_API_URL}/api/pending-transactions`);
        if (pendingResponse.data.success && pendingResponse.data.transactions) {
          const backendHashes = pendingResponse.data.transactions
            .filter(tx => tx.txHash && tx.txHash.length === 66) // Valid 32-byte hashes only
            .map(tx => tx.txHash);
          allTransactionHashes = allTransactionHashes.concat(backendHashes);
          console.log(`  🔗 Added ${backendHashes.length} backend transaction hashes`);
        }
      } catch (e) {
        console.log(`  ⚠️ Could not fetch backend transactions: ${e.message}`);
      }
    }

    if (allTransactionHashes.length === 0) {
      console.log(`  ⚠️ No transactions to submit to L1`);
      return;
    }

    // For now, use mock accumulator value (needs proper ECC calculation)
    const mockAccumulatorValue = {
      x: "0x1",
      y: "0x2"
    };

    console.log(`  📋 Submitting ${allTransactionHashes.length} transaction hashes to L1`);
    console.log(`  🔗 Transaction hashes:`, allTransactionHashes.slice(0, 3).map(h => h.substring(0, 10) + '...'));

    // Clear the arrays immediately to prevent reuse
    const hashesToSubmit = [...allTransactionHashes];
    relayTransactionHashes = [];

    // Submit block to L1
    const submitTx = await rootWithOperator.submitBlock(
      mockAccumulatorValue,
      hashesToSubmit.length,
      hashesToSubmit
    );

    console.log(`  ⏳ L1 submission tx: ${submitTx.hash}`);
    const receipt = await submitTx.wait();
    console.log(`  ✅ L1 block submission confirmed! Gas used: ${receipt.gasUsed.toString()}`);

    return receipt;
  } catch (error) {
    console.error(`  ❌ L1 block submission failed:`, error.message);
    throw error;
  }
}

// ===== L1 Block submission for relay transactions =====
async function maybeSubmitRelayBlock(reason = "auto") {
  try {
    // Only submit if we have relay transactions
    if (relayTransactionHashes.length === 0) {
      return;
    }

    // Check if we should submit block based on relay transaction count or timeout
    const shouldSubmit =
      relayTransactionsSinceLastBlock >= RELAY_TRANSACTIONS_PER_BLOCK ||
      ((Date.now() - lastRelayBlockTime) > RELAY_BLOCK_TIMEOUT && relayTransactionsSinceLastBlock > 0);

    if (shouldSubmit) {
      console.log(`\n🚀 Submitting L1 block (${reason}): ${relayTransactionsSinceLastBlock} relay transactions`);

      // Create a block data object for L1 submission
      const blockData = {
        blockNumber: Date.now(), // Temporary block number for relay transactions
        transactionCount: relayTransactionHashes.length,
        txHashes: [...relayTransactionHashes]
      };

      // Submit block to L1
      try {
        await submitBlockToL1(blockData);
        console.log(`  ✅ Successfully submitted ${relayTransactionHashes.length} relay transactions to L1`);
      } catch (error) {
        console.error(`  ⚠️ L1 submission failed:`, error.message);
      }

      // Clear relay transaction hashes after submission attempt
      relayTransactionHashes = [];
      relayTransactionsSinceLastBlock = 0;
      lastRelayBlockTime = Date.now();

      return blockData;
    }
  } catch (error) {
    console.error("L1 block submission error:", error.message);
  }
}

// ===== Relay logic =====
async function relayLog(log) {
  const txHash = log.transactionHash || log.txHash || (log.log && log.log.transactionHash);
  const logIndex = (log.logIndex ?? (log.log && log.log.logIndex));
  const key = txHash && (logIndex !== undefined) ? `${txHash}:${logIndex}` : null;

  if (key && processed.has(key)) {
    return;
  }

  const { user, token, amount } = log.args;
  const l2Token = mapL1ToL2Token(token);
  console.log(`[Relay] user=${user} tokenL1=${token} -> tokenL2=${l2Token} amount=${amount?.toString?.() || amount} L1#${log.blockNumber}`);

  const tx = await plasma.updateBalance(user, l2Token, amount);
  const rc = await tx.wait();
  console.log(`  ✔ L2 updateBalance tx: ${rc.hash}`);

  await maybeMint(user, l2Token, amount);

  if (key) remember(key);

  // Track the L2 updateBalance transaction hash for L1 submission
  relayTransactionHashes.push(rc.hash);

  // Increment relay transaction counter
  relayTransactionsSinceLastBlock++;
  console.log(`  📊 Relay transactions since last L1 submission: ${relayTransactionsSinceLastBlock}/${RELAY_TRANSACTIONS_PER_BLOCK}`);

  // Maybe submit relay block to L1
  await maybeSubmitRelayBlock("transaction_limit");
}

// ===== Periodic L1 block submission for relay transactions =====
setInterval(async () => {
  if (relayTransactionsSinceLastBlock > 0) {
    await maybeSubmitRelayBlock("timeout");
  }
}, RELAY_BLOCK_TIMEOUT);

// ===== Backfill by range =====
async function backfill(fromBlock, toBlock) {
  if (toBlock < fromBlock) {
    console.log(`[Backfill] skip (from=${fromBlock} > to=${toBlock})`);
    return;
  }
  const filter = root.filters.Deposit(null, null);
  const logs = await root.queryFilter(filter, fromBlock, toBlock);
  console.log(`[Backfill] ${logs.length} deposits from blocks [${fromBlock}, ${toBlock}]`);
  for (const log of logs) {
    try { 
      await relayLog(log); 
    } catch (e) { 
      console.error("  ✖ relay failed:", e?.shortMessage || e?.message || e); 
    }
  }
  state.lastBlock = toBlock;
  saveState(state);
}

// ===== Live: WS subscribe (preferred) or HTTP polling =====
function startWsListener() {
  const provider = l1;
  const attach = (prov) => {
    const c = new ethers.Contract(ROOT_CHAIN_ADDRESS, rootAbi, prov);
    const handler = async (...args) => {
      try {
        const ev = args[args.length - 1];
        const user   = args[0];
        const token  = args[1];
        const amount = args[2];

        const relayInput = {
          args: { user, token, amount },
          blockNumber: ev?.blockNumber ?? ev?.log?.blockNumber ?? -1,
          transactionHash: ev?.transactionHash ?? ev?.log?.transactionHash,
          logIndex: ev?.logIndex ?? ev?.log?.logIndex
        };

        if (relayInput.blockNumber !== -1) {
          if (state.lastBlock && relayInput.blockNumber <= state.lastBlock) return;
          state.lastBlock = Math.max(state.lastBlock || 0, relayInput.blockNumber);
          saveState(state);
        }
        await relayLog(relayInput);
      } catch (e) {
        console.error("[WS] relay failed:", e?.shortMessage || e?.message || e);
      }
    };

    startWsListener._contract = c;
    c.on("Deposit", handler);
    startWsListener._handler = handler;
    console.log("[Live-WS] subscribed to Deposit");
  };

  const detach = () => {
    try {
      startWsListener._contract?.off("Deposit", startWsListener._handler);
    } catch {}
  };

  attach(provider);

  const ws = provider._websocket;
  if (!ws) {
    console.warn("[WS] underlying websocket not exposed; fallback to HTTP polling");
    detach();
    return startHttpPolling();
  }

  ws.on("error", (err) => {
    console.warn("[WS] socket error:", err?.message || err);
  });

  ws.on("close", async () => {
    console.warn("[WS] socket closed; reconnecting in 1s…");
    detach();
    setTimeout(async () => {
      try {
        const newProv = new ethers.WebSocketProvider(SEPOLIA_WSS_URL);
        l1._websocket?.terminate?.();
        l1 = newProv;
        attach(newProv);
        console.log("[WS] reconnected & re-subscribed");
      } catch (e) {
        console.error("[WS] reconnect failed:", e?.message || e);
      }
    }, 1000);
  });

  console.log("[Live] listening (WS) for new deposits…");
}

function startHttpPolling() {
  let ticking = false;
  const tick = async () => {
    if (ticking) return; ticking = true;
    try {
      const latest = await l1.getBlockNumber();
      const from = (state.lastBlock ?? (latest - 1)) + 1;
      const to   = latest;
      if (to >= from) {
        const logs = await root.queryFilter(root.filters.Deposit(), from, to);
        for (const log of logs) { await relayLog(log); }
        state.lastBlock = to;
        saveState(state);
      }
    } catch (e) {
      const msg = e?.shortMessage || e?.message || "";
      if (msg.includes("eth_getFilterChanges") || msg.includes("resource not found")) {
        console.warn("[Poll] transient filter error; will retry");
      } else {
        console.error("[Poll] error:", msg);
      }
    } finally {
      ticking = false;
    }
  };

  setInterval(tick, 2000);
  console.log("[Live-HTTP] polling Deposit every 2s from block", state.lastBlock ?? "latest-1");
}

// ===== Main =====
(async () => {
  console.log("🚀 Enhanced Plasma ECC Relay - L1↔L2 Bridge");
  console.log("================================================");
  console.log("Function: Monitor L1 Deposits → Relay to L2 → Submit to L1");
  console.log("================================================");
  console.log("L1 Network                =", "Sepolia Testnet");
  console.log("L1 RootChain Contract     =", ROOT_CHAIN_ADDRESS);
  console.log("L2 Network                =", "Local Anvil");
  console.log("L2 PlasmaChain Contract   =", L2_PLASMA_CHAIN_ADDRESS);
  console.log("Operator (mint) address   =", await operator.getAddress());
  console.log("L2 token (mint target)    =", L2_PLASMA_TOKEN_ADDRESS || "<unset>");
  console.log("L1 submission settings:");
  console.log(`  - Submit block every ${RELAY_TRANSACTIONS_PER_BLOCK} relay transactions`);
  console.log(`  - Or every ${RELAY_BLOCK_TIMEOUT/1000} seconds`);
  console.log("================================================");

  const latest = await l1.getBlockNumber();
  const startFrom = state.lastBlock || Number(L1_FROM_BLOCK || latest - 1);
  if (startFrom < latest) {
    await backfill(startFrom, latest - 1);
  }

  // Live mode
  if (l1 instanceof ethers.WebSocketProvider) startWsListener();
  else startHttpPolling();

  console.log("\n✅ Relay started successfully!");
  console.log("📡 Listening for L1 Deposit events...");
  console.log("🔄 Will relay deposits to L2 automatically");
  console.log("🚀 Will submit relay blocks to L1 periodically\n");
})();