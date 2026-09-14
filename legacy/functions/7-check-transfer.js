const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

async function testTransferBetweenAccounts() {
    console.log('🔄 Testing Transfer from 0x62dc to 0xba4b...\n');

    // Setup - Use the exact accounts you specified
    const l2Provider = new ethers.JsonRpcProvider('http://localhost:8545');

    // From: 0x62dc14Fe819A241e176ee6A813f51045d04A0cda (has L2 balance from deposits)
    const fromWallet = new ethers.Wallet('79d5afa4d8b4e755efddefc8aa9f0cce663e9e96317e1d234d001824197794d1', l2Provider);
    const fromAddress = fromWallet.address; // Should be 0x62dc14Fe819A241e176ee6A813f51045d04A0cda
    const toAddress = '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76';

    console.log(`From: ${fromAddress}`);
    console.log(`To: ${toAddress}`);

    try {
        // Step 1: Check L2 token balance
        console.log(`\n1️⃣ Checking L2 token balance... : ${fromAddress}`);
        const tokenABI = [
            "function transfer(address to, uint256 amount) returns (bool)",
            "function balanceOf(address account) view returns (uint256)"
        ];

        const tokenContract = new ethers.Contract(
            process.env.L2_PLASMA_TOKEN_ADDRESS,
            tokenABI,
            fromWallet
        );

        const balance = await tokenContract.balanceOf(fromAddress);
        console.log(`From account balance: ${ethers.formatEther(balance)} tokens`);

        if (balance < ethers.parseEther('1')) {
            console.log('❌ Insufficient balance for transfer');
            return;
        }

        // Step 2: Check initial pending transactions
        console.log('\n2️⃣ Checking initial pending transactions...');
        let response = await axios.get('http://localhost:3001/api/pending-transactions');
        console.log(`Initial pending: ${response.data.count}`);

        // Step 3: Do a direct ERC-20 transfer
        console.log('\n3️⃣ Performing ERC-20 transfer...');
        const transferAmount = ethers.parseEther('1'); // 1 token
        const tx = await tokenContract.transfer(toAddress, transferAmount);
        const receipt = await tx.wait();

        console.log(`✅ ERC-20 transfer completed: ${receipt.hash}`);
        console.log(`Block: ${receipt.blockNumber}`);
        console.log(`Gas used: ${receipt.gasUsed.toString()}`);

        // Step 4: Register the ERC-20 transfer with the backend API
        console.log('\n4️⃣ Registering ERC-20 transfer with API...');
        const registerResponse = await axios.post('http://localhost:3001/api/register-erc20-transfer', {
            txHash: receipt.hash,
            from: fromAddress,
            to: toAddress,
            amount: '1.0',
            tokenAddress: process.env.L2_PLASMA_TOKEN_ADDRESS,
            blockNumber: receipt.blockNumber
        });

        if (registerResponse.data.success) {
            console.log('✅ Transfer registered successfully!');
            console.log(`Pending count: ${registerResponse.data.data.pendingCount}`);
        } else {
            console.log('❌ Transfer registration failed:', registerResponse.data);
        }

        // Step 5: Check pending transactions after registration
        console.log('\n5️⃣ Checking pending transactions after registration...');
        response = await axios.get('http://localhost:3001/api/pending-transactions');
        console.log(`New pending: ${response.data.count}`);

        if (response.data.count > 0) {
            console.log('Recent transfers:');
            response.data.transactions.slice(-3).forEach((tx, i) => {
                console.log(`  ${i+1}. ${tx.from.substring(0,8)}... -> ${tx.to.substring(0,8)}...: ${tx.amount} tokens`);
            });

            console.log('\n🔨 This should trigger block creation in the backend server!');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    }
}

testTransferBetweenAccounts();