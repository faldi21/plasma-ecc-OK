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
// Change this to 'L1' or 'L2' to select which network to mint on
const NETWORK = process.argv[2]?.toUpperCase() || 'L1';

// --- Get network-specific config ---
function getNetworkConfig() {
  if (NETWORK === 'L2') {
    return {
      rpcUrl: process.env.L2_RPC_URL?.trim() || 'http://localhost:8545',
      privateKey: process.env.L2_OPERATOR_PRIVATE_KEY?.trim() || process.env.DEPLOYER_PRIVATE_KEY?.trim(),
      tokenAddress: process.env.L2_PLASMA_TOKEN_ADDRESS?.trim(),
      networkName: 'L2 (Anvil)',
    };
  } else {
    return {
      rpcUrl: process.env.SEPOLIA_RPC_URL?.trim(),
      privateKey: process.env.DEPLOYER_PRIVATE_KEY?.trim(),
      tokenAddress: process.env.PLASMA_TOKEN_ADDRESS?.trim(),
      networkName: 'L1 (Sepolia)',
    };
  }
}

const config = getNetworkConfig();

// --- Validasi env variables ---
if (!config.rpcUrl) throw new Error(`RPC URL tidak ditemukan untuk ${config.networkName}`);
if (!config.privateKey) throw new Error(`Private key tidak ditemukan untuk ${config.networkName}`);
if (!config.tokenAddress) throw new Error(`Token address tidak ditemukan untuk ${config.networkName}`);

if (!config.privateKey.startsWith("0x") || config.privateKey.length !== 66) {
  throw new Error("Private key tidak valid (harus diawali '0x' dan 66 karakter)");
}

// --- Muat ABI PlasmaToken ---
const abiPath = path.resolve(__dirname, "../backend/abi/PlasmaToken.json");
if (!fs.existsSync(abiPath)) {
  throw new Error("File PlasmaToken.json tidak ditemukan di: " + abiPath);
}

const tokenABI = JSON.parse(fs.readFileSync(abiPath, "utf8")).abi;

// --- Fungsi utama ---
async function getTokens() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const token = new ethers.Contract(config.tokenAddress, tokenABI, wallet);

  console.log("=".repeat(60));
  console.log("           PLASMA TOKEN MINTING");
  console.log("=".repeat(60));
  console.log(`Network:       ${config.networkName}`);
  console.log(`Wallet:        ${await wallet.getAddress()}`);
  console.log(`RPC URL:       ${config.rpcUrl}`);
  console.log(`Token Address: ${config.tokenAddress}`);
  console.log("=".repeat(60));
  console.log("\nMinting tokens for test users...\n");

  // --- Daftar test address ---
  const testAddresses = [
    "0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76", // PK_USER_A
    "0x62dc14Fe819A241e176ee6A813f51045d04A0cda",
    "0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab",
  ];

  const mintAmount = ethers.parseEther("100000");

  for (const address of testAddresses) {
    try {
      // Check current balance first
      const balanceBefore = await token.balanceOf(address);
      console.log(`[${address.slice(0,10)}...] Current balance: ${ethers.formatEther(balanceBefore)} PLASMA`);

      // Mint tokens
      const tx = await token.mint(address, mintAmount);
      console.log(`[${address.slice(0,10)}...] Minting ${ethers.formatEther(mintAmount)} PLASMA... TX: ${tx.hash.slice(0,20)}...`);
      await tx.wait();

      // Check new balance
      const balanceAfter = await token.balanceOf(address);
      console.log(`[${address.slice(0,10)}...] New balance: ${ethers.formatEther(balanceAfter)} PLASMA`);
      console.log("");
    } catch (error) {
      console.error(`[${address.slice(0,10)}...] Error: ${error.message}\n`);
    }
  }
}

// --- Show usage ---
console.log("\nUsage: node 1-get-tokens.js [L1|L2]");
console.log("  L1 = Mint on Sepolia (default)");
console.log("  L2 = Mint on Anvil (local L2)\n");

// --- Jalankan fungsi ---
getTokens()
  .then(() => {
    console.log("=".repeat(60));
    console.log("Token minting complete!");
    console.log("=".repeat(60));
  })
  .catch((err) => console.error("Error:", err.message));
