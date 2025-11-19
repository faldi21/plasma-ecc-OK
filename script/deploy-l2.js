// --- Imports ---
import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ✅ Modern JSON import syntax (Node 20+)
import { readFileSync } from "fs";

const PlasmaToken = JSON.parse(
  readFileSync(new URL("../out/PlasmaToken.sol/PlasmaToken.json", import.meta.url))
);
const PlasmaChain = JSON.parse(
  readFileSync(new URL("../out/PlasmaChain.sol/PlasmaChain.json", import.meta.url))
);


// --- Setup path dan load .env ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath });

// ===== UTIL: update .env =====
function upsertEnvVars(updates) {
  let text = "";
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch {}

  try {
    const bakPath = envPath + ".bak";
    fs.writeFileSync(bakPath, text);
    console.log(`🗄  Backup .env → ${path.relative(process.cwd(), bakPath)}`);
  } catch (e) {
    console.warn("⚠️  Gagal membuat backup .env (lanjut):", e.message);
  }

  const lines = text.split(/\r?\n/);
  const map = new Map();
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) map.set(m[1], m[2]);
  }
  for (const [k, v] of Object.entries(updates)) {
    map.set(k, String(v));
  }

  const out = [];
  const existingKeys = new Set(Object.keys(updates));
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) {
      out.push(line);
      continue;
    }
    const key = m[1];
    if (key in updates) {
      out.push(`${key}=${map.get(key)}`);
      existingKeys.delete(key);
    } else {
      out.push(line);
    }
  }
  for (const k of existingKeys) {
    out.push(`${k}=${map.get(k)}`);
  }

  const tmp = envPath + ".tmp";
  fs.writeFileSync(tmp, out.join("\n"));
  fs.renameSync(tmp, envPath);
  console.log(`✅ .env updated: ${Object.keys(updates).join(", ")}`);
}

// ===== MAIN DEPLOY FUNCTION =====
async function deployL2Contracts() {
  console.log("🚀 Deploying contracts to L2 (localhost:8545)…\n");

  const l2Provider = new ethers.JsonRpcProvider("http://localhost:8545");

  const L2_OPERATOR_PRIVATE_KEY =
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
  const l2Deployer = new ethers.Wallet(L2_OPERATOR_PRIVATE_KEY, l2Provider);
  console.log("L2 Deployer:", l2Deployer.address);

  try {
    // === DEPLOY PLASMA TOKEN ===
    const tokenFactory = new ethers.ContractFactory(
      PlasmaToken.abi,
      PlasmaToken.bytecode.object || PlasmaToken.bytecode,
      l2Deployer
    );

    console.log("Deploying PlasmaToken to L2…");
    const l2Token = await tokenFactory.deploy(
      "Plasma Token",
      "PLASMA",
      ethers.parseEther("1000000")
    );
    await l2Token.waitForDeployment();
    const tokenReceipt = await l2Token.deploymentTransaction().wait(1);
    console.log("✅ PlasmaToken deployed to L2:", l2Token.target);
    console.log("   Block:", tokenReceipt.blockNumber);

    await new Promise((r) => setTimeout(r, 800));

    // === DEPLOY PLASMA CHAIN ===
    const plasmaChainFactory = new ethers.ContractFactory(
      PlasmaChain.abi,
      PlasmaChain.bytecode.object || PlasmaChain.bytecode,
      l2Deployer
    );

    console.log("\nDeploying PlasmaChain to L2…");
    const plasmaChain = await plasmaChainFactory.deploy();
    await plasmaChain.waitForDeployment();
    const chainReceipt = await plasmaChain.deploymentTransaction().wait(1);
    console.log("✅ PlasmaChain deployed to L2:", plasmaChain.target);
    console.log("   Block:", chainReceipt.blockNumber);

    // === SAVE ADDRESSES ===
    const addresses = {
      L2_PLASMA_CHAIN: plasmaChain.target,
      L2_PLASMA_TOKEN: l2Token.target,
      L2_OPERATOR: l2Deployer.address,
    };
    const OUT_JSON = path.resolve(process.cwd(), "l2-addresses.json");
    fs.writeFileSync(OUT_JSON, JSON.stringify(addresses, null, 2));
    console.log(`\n📝 L2 addresses saved → ${path.relative(process.cwd(), OUT_JSON)}`);

    // === UPDATE .env ===
    console.log("\n📋 Add these to your .env file:");
    console.log(`L2_PLASMA_CHAIN_ADDRESS=${plasmaChain.target}`);
    console.log(`L2_PLASMA_TOKEN_ADDRESS=${l2Token.target}`);
    console.log(`L2_OPERATOR_PRIVATE_KEY=${L2_OPERATOR_PRIVATE_KEY}`);

    upsertEnvVars({
      L2_PLASMA_CHAIN_ADDRESS: plasmaChain.target,
      L2_PLASMA_TOKEN_ADDRESS: l2Token.target,
      L2_OPERATOR_PRIVATE_KEY,
      L2_RPC_URL: "http://localhost:8545",
    });

    console.log("\n🎯 Finished. Updated .env with fresh L2 addresses.");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exitCode = 1;
  }
}

deployL2Contracts();
