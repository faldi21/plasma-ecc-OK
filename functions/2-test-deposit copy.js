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

async function testDeposit() {
    // Setup
    const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);

    // wallet 0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76
     const userWallet = new ethers.Wallet('873f5eb8696d033c40d9990310b9c618bf8defdcec4e0c3abc2db3f88e451080', provider);

    //wallet 0x62dc14Fe819A241e176ee6A813f51045d04A0cda
    //const userWallet = new ethers.Wallet('79d5afa4d8b4e755efddefc8aa9f0cce663e9e96317e1d234d001824197794d1', provider);

    //wallet 0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab
    //const userWallet = new ethers.Wallet('0x070d8f7d287854522182733db1f2f5fc4609480167dced6a1e93213b22694aa3', provider);

     //const userWallet = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
    
   //const userWallet = new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', provider);


    // Contracts
    //const tokenABI = require('../../backend/abi/PlasmaToken.json').abi;
    //const rootChainABI = require('../../backend/abi/RootChain.json').abi;

    const abiPath = path.resolve(__dirname, "../backend/abi/PlasmaToken.json");
    if (!fs.existsSync(abiPath)) {
      throw new Error("❌ File PlasmaToken.json tidak ditemukan di: " + abiPath);
    }

    const abirootPath = path.resolve(__dirname, "../backend/abi/RootChain.json");
    if (!fs.existsSync(abirootPath)) {
      throw new Error("❌ File PlasmaToken.json tidak ditemukan di: " + abirootPath);
    }
    
    const tokenABI = JSON.parse(fs.readFileSync(abiPath, "utf8")).abi;
    const rootChainABI = JSON.parse(fs.readFileSync(abirootPath, "utf8")).abi;
    

    // Validasi env
    console.log('ROOT_CHAIN_ADDRESS:', process.env.ROOT_CHAIN_ADDRESS); // debug
    if (!process.env.PLASMA_TOKEN_ADDRESS || !process.env.ROOT_CHAIN_ADDRESS) {
        throw new Error('PLASMA_TOKEN_ADDRESS atau ROOT_CHAIN_ADDRESS belum di-set di .env');
    }

    const token = new ethers.Contract(process.env.PLASMA_TOKEN_ADDRESS, tokenABI, userWallet);
    const rootChain = new ethers.Contract(process.env.ROOT_CHAIN_ADDRESS, rootChainABI, userWallet);
    console.log('rootChain.target:', rootChain.target); // debug

    const depositAmount = ethers.parseEther('2000');

    // ...existing code...

    console.log('🚀 Starting deposit test...\n');
    console.log(`User address: ${userWallet.address}`);

    try {
        // Step 1: Check balance
        const balance = await token.balanceOf(userWallet.address);
        console.log(`Current token balance: ${ethers.formatEther(balance)} tokens`);

        // Step 2: Approve tokens
        if (!rootChain.target) {
            throw new Error('rootChain.target undefined! Cek ROOT_CHAIN_ADDRESS di .env');
        }
        console.log('\n📝 Approving tokens...');
        const approveTx = await token.approve(rootChain.target, depositAmount);
        await approveTx.wait();
        console.log('✅ Tokens approved');
        
        // Step 3: Deposit to Plasma
        console.log('\n💰 Depositing to Plasma L2...');
        const depositTx = await rootChain.deposit(token.target, depositAmount);
        const receipt = await depositTx.wait();
        console.log(`✅ Deposit : ${ethers.formatEther(depositAmount)} tokens successful!`);
        console.log(`Transaction hash: ${receipt.hash}`);

        // Step 4: Check L2 balance via API
        /*console.log('\n🔍 Checking L2 balance...');
        const response = await fetch(`http://localhost:3001/api/balance/${userWallet.address}/${token.target}`);
        const data = await response.json();
        console.log('API response:', data); // debug
        if (!data.success) {
            console.error('API Error:', data.error);
        } else {
            console.log(`L2 Balance: ${data.balance} tokens`);
        }*/
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testDeposit();