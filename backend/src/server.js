const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
require('dotenv').config();

const plasmaService = require('./plasma/plasmaService');
const accumulatorService = require('./accumulator/accumulatorService');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize services
const PORT = process.env.PORT || 3001;

// API Routes
app.post('/api/deposit', async (req, res) => {
    try {
        const { userAddress, tokenAddress, amount } = req.body;
        const result = await plasmaService.processDeposit(userAddress, tokenAddress, amount);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/transfer', async (req, res) => {
    try {
        const { from, to, tokenAddress, amount, signature, nonce, timestamp } = req.body;
        const result = await plasmaService.processTransfer(from, to, tokenAddress, amount, signature, nonce, timestamp);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/exit', async (req, res) => {
    try {
        const { userAddress, tokenAddress, amount, blockNumber, txHash } = req.body;
        const result = await plasmaService.startExit(userAddress, tokenAddress, amount, blockNumber, txHash);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/finalize-exit', async (req, res) => {
    try {
        const { exitId } = req.body;
        const result = await plasmaService.finalizeExit(exitId);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/exit/:exitId', async (req, res) => {
    try {
        const { exitId } = req.params;
        const result = await plasmaService.getExitInfo(exitId);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/balance/:address/:token', async (req, res) => {
    try {
        const { address, token } = req.params;
        const balance = await plasmaService.getBalance(address, token);
        console.log('DEBUG balance:', balance); // Tambahkan log ini
        res.json({ success: true, balance });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/block/:blockNumber', async (req, res) => {
    try {
        const { blockNumber } = req.params;
        const block = await plasmaService.getBlock(blockNumber);
        res.json({ success: true, block });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/create-block', async (req, res) => {
    try {
        const result = await plasmaService.createBlock();
        if (result) {
            res.json({ success: true, data: result });
        } else {
            res.json({ success: false, message: 'No pending transactions to create block' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/create-block-force', async (req, res) => {
    try {
        const { relayTransactions, reason } = req.body;
        const result = await plasmaService.createBlock(true); // force creation
        if (result) {
            result.relayTransactions = relayTransactions || 0;
            result.reason = reason || 'force';
            res.json({ success: true, data: result });
        } else {
            // No pending transactions at all
            console.log('⚠️  No pending transactions to create block');
            res.json({
                success: false,
                message: 'No pending transactions to create block',
                pendingCount: 0
            });
        }
    } catch (error) {
        console.error('Create block force error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/pending-transactions', async (req, res) => {
    try {
        const pending = plasmaService.getPendingTransactions();
        res.json({ success: true, count: pending.length, transactions: pending });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// New endpoint to register ERC-20 transfers as pending transactions
app.post('/api/register-erc20-transfer', async (req, res) => {
    try {
        const { txHash, from, to, amount, tokenAddress, blockNumber } = req.body;
        const result = await plasmaService.registerERC20Transfer(txHash, from, to, amount, tokenAddress, blockNumber);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint to get recent ERC-20 transfers and auto-register them
app.get('/api/scan-erc20-transfers', async (req, res) => {
    try {
        const fromBlock = req.query.fromBlock || 'latest';
        const transfers = await plasmaService.scanAndRegisterERC20Transfers(fromBlock);
        res.json({ success: true, transfers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Plasma Layer 2 server running on port ${PORT}`);
});
