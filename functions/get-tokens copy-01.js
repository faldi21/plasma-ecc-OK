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

// --- Validasi env variables ---
const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim();
const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
const tokenAddress = process.env.PLASMA_TOKEN_ADDRESS?.trim();

if (!rpcUrl) throw new Error("❌ SEPOLIA_RPC_URL tidak ditemukan di .env");
if (!privateKey) throw new Error("❌ DEPLOYER_PRIVATE_KEY tidak ditemukan di .env");
if (!tokenAddress) throw new Error("❌ PLASMA_TOKEN_ADDRESS tidak ditemukan di .env");

if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
  throw new Error("❌ DEPLOYER_PRIVATE_KEY tidak valid (harus diawali '0x' dan 66 karakter)");
}

// --- Muat ABI PlasmaToken ---
const abiPath = path.resolve(__dirname, "../backend/abi/PlasmaToken.json");
if (!fs.existsSync(abiPath)) {
  throw new Error("❌ File PlasmaToken.json tidak ditemukan di: " + abiPath);
}

const tokenABI = JSON.parse(fs.readFileSync(abiPath, "utf8")).abi;

// --- Fungsi utama ---
async function getTokens() {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const token = new ethers.Contract(tokenAddress, tokenABI, wallet);

  console.log("✅ Wallet:", await wallet.getAddress());
  console.log("✅ RPC URL:", rpcUrl);
  console.log("✅ Token Address:", tokenAddress);
  console.log("\n🚀 Minting tokens for test users...\n");

  // --- Daftar test address ---
  const testAddresses = [
    "0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab",
    "0x62dc14Fe819A241e176ee6A813f51045d04A0cda",
    "0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76",
    //"0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab",
  ];

  for (const address of testAddresses) {
    try {
      const tx = await token.mint(address, ethers.parseEther("100000"));
      await tx.wait();

      const balance = await token.balanceOf(address);
      console.log(`✅ Minted ${ethers.formatEther(balance)} tokens to ${address}`);
    } catch (error) {
      console.error(`❌ Error minting to ${address}:`, error.message);
    }
  }
}

// --- Jalankan fungsi ---
getTokens()
  .then(() => console.log("\n✨ Token distribution complete!"))
  .catch((err) => console.error("🚨 Error:", err.message));
