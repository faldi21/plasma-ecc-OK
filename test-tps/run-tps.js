const { ethers } = require('ethers');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configuration
const CONFIG = {
    TOTAL_TRANSACTIONS: 100, // Small batch for verification
    API_URL: 'http://localhost:3001/api',
    L2_RPC: 'http://localhost:8545',
    TOKEN_ADDRESS: process.env.L2_PLASMA_TOKEN_ADDRESS,
    PLASMA_CHAIN_ADDRESS: process.env.L2_PLASMA_CHAIN_ADDRESS
};

// User Accounts
const ACCOUNTS = [
    '79d5afa4d8b4e755efddefc8aa9f0cce663e9e96317e1d234d001824197794d1', // 0x62dc...
    '873f5eb8696d033c40d9990310b9c618bf8defdcec4e0c3abc2db3f88e451080', // 0xba4B...
    '0x070d8f7d287854522182733db1f2f5fc4609480167dced6a1e93213b22694aa3'  // 0xfa54...
];

// Setup provider
const provider = new ethers.JsonRpcProvider(CONFIG.L2_RPC);

// ABI
const plasmaChainABI = [
    "function nonces(address user) view returns (uint256)"
];
const plasmaChain = new ethers.Contract(CONFIG.PLASMA_CHAIN_ADDRESS, plasmaChainABI, provider);

async function main() {
    console.log('🚀 Starting TPS Test (Optimistic Mode)');
    console.log('-----------------------------------');
    console.log(`Target: ${CONFIG.TOTAL_TRANSACTIONS} transactions`);
    console.log(`Accounts: ${ACCOUNTS.length}`);
    
    try {
        // Initialize wallets
        const wallets = ACCOUNTS.map(pk => new ethers.Wallet(pk, provider));
        
        // Check initial nonces
        console.log('\n1️⃣  Checking initial nonces...');
        const walletNonces = new Map();
        for (const wallet of wallets) {
            const nonce = await plasmaChain.nonces(wallet.address);
            walletNonces.set(wallet.address, Number(nonce));
            console.log(`   ${wallet.address.slice(0,10)}... : ${nonce}`);
        }
        console.log('   ✅ Nonces loaded');

        // Prepare transactions
        console.log('\n2️⃣  Executing transactions...');
        const startTime = Date.now();
        
        // Distribute transactions across accounts
        const txsPerAccount = Math.ceil(CONFIG.TOTAL_TRANSACTIONS / wallets.length);
        
        // Create worker for each account
        const workers = wallets.map(async (wallet) => {
            let accountSuccess = 0;
            let accountFail = 0;
            let currentNonce = walletNonces.get(wallet.address);
            
            // Send transactions sequentially per account
            for (let i = 0; i < txsPerAccount; i++) {
                // Send to a random address
                const to = ethers.Wallet.createRandom().address;
                const nonce = currentNonce++;
                
                // Await response to ensure order
                const success = await sendTransaction(wallet, to, nonce);
                if (success) {
                    accountSuccess++;
                } else {
                    accountFail++;
                }
            }
            
            return { success: accountSuccess, fail: accountFail };
        });
        
        const workerResults = await Promise.all(workers);
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        const totalSuccess = workerResults.reduce((acc, curr) => acc + curr.success, 0);
        const totalFail = workerResults.reduce((acc, curr) => acc + curr.fail, 0);
        
        console.log('\n\n📊 Test Results');
        console.log('-----------------------------------');
        console.log(`Total Time:      ${duration.toFixed(2)} seconds`);
        console.log(`Total Requests:  ${totalSuccess + totalFail}`);
        console.log(`Successful:      ${totalSuccess}`);
        console.log(`Failed:          ${totalFail}`);
        console.log(`Throughput:      ${(totalSuccess / duration).toFixed(2)} TPS`);
        console.log('-----------------------------------');

    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

async function sendTransaction(wallet, to, nonce) {
    try {
        const amount = ethers.parseEther('0.0001'); // Small amount
        
        // Create signature
        const messageHash = ethers.solidityPackedKeccak256(
            ['address', 'address', 'address', 'uint256', 'uint256'],
            [wallet.address, to, CONFIG.TOKEN_ADDRESS, amount, nonce]
        );
        
        const signature = await wallet.signMessage(ethers.getBytes(messageHash));
        
        // Send to API
        const payload = {
            from: wallet.address,
            to: to,
            tokenAddress: CONFIG.TOKEN_ADDRESS,
            amount: '0.0001',
            signature: signature,
            nonce: nonce.toString(),
            timestamp: Date.now()
        };
        
        const response = await axios.post(`${CONFIG.API_URL}/transfer`, payload);
        return response.data.success;
    } catch (error) {
        console.error(`Tx failed:`, error.response?.data || error.message);
        return false;
    }
}

main();
