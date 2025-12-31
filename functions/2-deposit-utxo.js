import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// --- Setup path dan load .env ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath });

// --- Configuration ---
const USER_WALLETS = {
  A: {
    address: "0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76",
    privateKey: "873f5eb8696d033c40d9990310b9c618bf8defdcec4e0c3abc2db3f88e451080",
  },
  B: {
    address: "0x62dc14Fe819A241e176ee6A813f51045d04A0cda",
    privateKey: "79d5afa4d8b4e755efddefc8aa9f0cce663e9e96317e1d234d001824197794d1",
  },
  C: {
    address: "0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab",
    privateKey: "0x070d8f7d287854522182733db1f2f5fc4609480167dced6a1e93213b22694aa3",
  },
};

// Parse command line arguments
const args = process.argv.slice(2);
const userKey = args[0]?.toUpperCase() || "A";
const depositAmountArg = args[1] || "1000";

async function depositUTXO() {
  console.log("=".repeat(60));
  console.log("           PLASMA UTXO DEPOSIT");
  console.log("=".repeat(60));

  // --- Validate environment ---
  const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim();
  const rootChainAddress = process.env.ROOT_CHAIN_UTXO_ADDRESS?.trim();
  const tokenAddress = process.env.PLASMA_TOKEN_ADDRESS?.trim();

  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL tidak ditemukan di .env");
  if (!rootChainAddress) throw new Error("ROOT_CHAIN_UTXO_ADDRESS tidak ditemukan di .env");
  if (!tokenAddress) throw new Error("PLASMA_TOKEN_ADDRESS tidak ditemukan di .env");

  // --- Get user wallet ---
  const userConfig = USER_WALLETS[userKey];
  if (!userConfig) {
    throw new Error(`User ${userKey} tidak ditemukan. Gunakan: A, B, atau C`);
  }

  // --- Load ABIs ---
  const tokenAbiPath = path.resolve(__dirname, "../backend/abi/PlasmaToken.json");
  const rootChainAbiPath = path.resolve(__dirname, "../backend/abi/RootChainUTXO.json");

  if (!fs.existsSync(tokenAbiPath)) {
    throw new Error("File PlasmaToken.json tidak ditemukan di: " + tokenAbiPath);
  }
  if (!fs.existsSync(rootChainAbiPath)) {
    throw new Error("File RootChainUTXO.json tidak ditemukan di: " + rootChainAbiPath);
  }

  const tokenABI = JSON.parse(fs.readFileSync(tokenAbiPath, "utf8")).abi;
  const rootChainABI = JSON.parse(fs.readFileSync(rootChainAbiPath, "utf8")).abi;

  // --- Setup provider and wallet ---
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(userConfig.privateKey, provider);

  // --- Setup contracts ---
  const token = new ethers.Contract(tokenAddress, tokenABI, wallet);
  const rootChain = new ethers.Contract(rootChainAddress, rootChainABI, wallet);

  const depositAmount = ethers.parseEther(depositAmountArg);

  console.log(`Network:           Sepolia (L1)`);
  console.log(`User:              ${userKey} (${userConfig.address})`);
  console.log(`RootChainUTXO:     ${rootChainAddress}`);
  console.log(`Token:             ${tokenAddress}`);
  console.log(`Deposit Amount:    ${depositAmountArg} PLASMA`);
  console.log("=".repeat(60));

  try {
    // Step 1: Check token balance
    console.log("\n[1/4] Checking token balance...");
    const balance = await token.balanceOf(wallet.address);
    console.log(`      Current balance: ${ethers.formatEther(balance)} PLASMA`);

    if (balance < depositAmount) {
      throw new Error(`Insufficient balance. Need ${depositAmountArg} but have ${ethers.formatEther(balance)}`);
    }

    // Step 2: Check allowance and approve if needed
    console.log("\n[2/4] Checking allowance...");
    const currentAllowance = await token.allowance(wallet.address, rootChainAddress);
    console.log(`      Current allowance: ${ethers.formatEther(currentAllowance)} PLASMA`);

    if (currentAllowance < depositAmount) {
      console.log("      Approving tokens (max allowance)...");
      // Approve max amount to avoid future approvals
      const maxApproval = ethers.MaxUint256;
      const approveTx = await token.approve(rootChainAddress, maxApproval);
      console.log(`      Approve TX: ${approveTx.hash}`);
      console.log(`      Waiting for confirmation...`);
      const approveReceipt = await approveTx.wait();
      console.log(`      Tokens approved! Block: ${approveReceipt.blockNumber}`);
    } else {
      console.log("      Allowance sufficient, skipping approve");
    }

    // Step 3: Deposit to RootChainUTXO
    console.log("\n[3/4] Depositing to RootChainUTXO...");
    const depositTx = await rootChain.deposit(tokenAddress, depositAmount);
    console.log(`      Deposit TX: ${depositTx.hash}`);
    console.log(`      Waiting for confirmation...`);

    const receipt = await depositTx.wait();
    console.log(`      Deposit confirmed in block ${receipt.blockNumber}`);

    // Step 4: Parse DepositCreated event to get UTXO ID
    console.log("\n[4/4] Parsing deposit event...");

    // Find DepositCreated event
    const depositEvent = receipt.logs.find((log) => {
      try {
        const parsed = rootChain.interface.parseLog({ topics: log.topics, data: log.data });
        return parsed?.name === "DepositCreated";
      } catch {
        return false;
      }
    });

    if (depositEvent) {
      const parsed = rootChain.interface.parseLog({ topics: depositEvent.topics, data: depositEvent.data });
      const utxoId = parsed.args.utxoId;
      const depositor = parsed.args.depositor;
      const tokenAddr = parsed.args.token;
      const amount = parsed.args.amount;

      console.log("\n" + "=".repeat(60));
      console.log("           DEPOSIT SUCCESSFUL!");
      console.log("=".repeat(60));
      console.log(`UTXO ID:     ${utxoId}`);
      console.log(`Depositor:   ${depositor}`);
      console.log(`Token:       ${tokenAddr}`);
      console.log(`Amount:      ${ethers.formatEther(amount)} PLASMA`);
      console.log(`TX Hash:     ${receipt.hash}`);
      console.log("=".repeat(60));

      // Check new balance
      const newBalance = await token.balanceOf(wallet.address);
      console.log(`\nNew token balance: ${ethers.formatEther(newBalance)} PLASMA`);

      // Notify backend about deposit (optional)
      try {
        console.log("\nNotifying backend...");
        const response = await fetch("http://localhost:3001/api/transactions/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "UTXO_DEPOSIT",
            utxoId: utxoId,
            txHash: receipt.hash,
            from: depositor,
            token: tokenAddr,
            amount: amount.toString(),
          }),
        });
        const data = await response.json();
        if (data.success) {
          console.log(`Backend notified. Pending count: ${data.pendingCount}`);
        } else {
          console.log(`Backend notification failed: ${data.error}`);
        }
      } catch (err) {
        console.log("Backend not available (relay will handle event)");
      }

    } else {
      console.log("Warning: DepositCreated event not found in logs");
      console.log(`Deposit TX: ${receipt.hash}`);
    }

  } catch (error) {
    console.error("\nError:", error.message);
    if (error.data) {
      console.error("Error data:", error.data);
    }
  }
}

// --- Show usage ---
console.log("\nUsage: node 2-deposit-utxo.js [USER] [AMOUNT]");
console.log("  USER   = A, B, or C (default: A)");
console.log("  AMOUNT = deposit amount in PLASMA (default: 1000)\n");
console.log("Examples:");
console.log("  node 2-deposit-utxo.js A 500");
console.log("  node 2-deposit-utxo.js B 2000\n");

// --- Run ---
depositUTXO();
