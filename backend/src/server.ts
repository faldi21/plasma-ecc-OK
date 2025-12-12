import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { envConfig } from './config/env.js';
import plasmaService from './plasma/PlasmaService.js';
import type { Address, Hex } from 'viem';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const PORT = parseInt(envConfig.PORT || '3001', 10);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'plasma-l2-backend' });
});

// Config endpoint - expose contract addresses
app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    L2_PLASMA_CHAIN_ADDRESS: envConfig.L2_PLASMA_CHAIN_ADDRESS,
    L2_PLASMA_TOKEN_ADDRESS: envConfig.L2_PLASMA_TOKEN_ADDRESS,
    PLASMA_TOKEN_ADDRESS: envConfig.PLASMA_TOKEN_ADDRESS,
    ROOT_CHAIN_ADDRESS: envConfig.ROOT_CHAIN_ADDRESS,
  });
});

// Deposit endpoint
app.post('/api/deposit', async (req: Request, res: Response) => {
  try {
    const { userAddress, tokenAddress, amount } = req.body as {
      userAddress: Address;
      tokenAddress: Address;
      amount: string;
    };

    if (!userAddress || !tokenAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userAddress, tokenAddress, amount',
      });
    }

    const result = await plasmaService.processDeposit(userAddress, tokenAddress, amount);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Deposit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Transfer endpoint
app.post('/api/transfer', async (req: Request, res: Response) => {
  try {
    const { from, to, tokenAddress, amount, signature, nonce, timestamp } = req.body as {
      from: Address;
      to: Address;
      tokenAddress: Address;
      amount: string;
      signature: Hex;
      nonce: string;
      timestamp?: number;
    };

    if (!from || !to || !tokenAddress || !amount || !signature || nonce === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: from, to, tokenAddress, amount, signature, nonce',
      });
    }

    const result = await plasmaService.processTransfer(from, to, tokenAddress, amount, signature, nonce, timestamp);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Transfer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Request withdrawal endpoint
app.post('/api/request-withdrawal', async (req: Request, res: Response) => {
  try {
    const { userAddress, tokenAddress, amount } = req.body as {
      userAddress: Address;
      tokenAddress: Address;
      amount: string;
    };

    if (!userAddress || !tokenAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userAddress, tokenAddress, amount',
      });
    }

    const result = await plasmaService.requestWithdrawal(userAddress, tokenAddress, amount);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Request withdrawal error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start exit endpoint
app.post('/api/exit', async (req: Request, res: Response) => {
  try {
    const { userAddress, tokenAddress, amount, blockNumber, txHash } = req.body as {
      userAddress: Address;
      tokenAddress: Address;
      amount: string;
      blockNumber: number;
      txHash: Hex;
    };

    if (!userAddress || !tokenAddress || !amount || blockNumber === undefined || !txHash) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userAddress, tokenAddress, amount, blockNumber, txHash',
      });
    }

    const result = await plasmaService.startExit(userAddress, tokenAddress, amount, blockNumber, txHash);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Exit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Finalize exit endpoint
app.post('/api/finalize-exit', async (req: Request, res: Response) => {
  try {
    const { exitId } = req.body as { exitId: string };

    if (!exitId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: exitId',
      });
    }

    const result = await plasmaService.finalizeExit(BigInt(exitId));
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Finalize exit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get exit info endpoint
app.get('/api/exit/:exitId', async (req: Request, res: Response) => {
  try {
    const { exitId } = req.params;

    if (!exitId) {
      return res.status(400).json({
        success: false,
        error: 'Missing exitId parameter',
      });
    }

    const result = await plasmaService.getExitInfo(BigInt(exitId));
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Get exit info error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get balance endpoint
app.get('/api/balance/:address/:token', async (req: Request, res: Response) => {
  try {
    const { address, token } = req.params as { address: Address; token: Address };

    if (!address || !token) {
      return res.status(400).json({
        success: false,
        error: 'Missing address or token parameter',
      });
    }

    const balance = await plasmaService.getBalance(address, token);
    console.log('DEBUG balance:', balance);
    res.json({ success: true, balance });
  } catch (error: any) {
    console.error('Get balance error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get block info endpoint
app.get('/api/block/:blockNumber', async (req: Request, res: Response) => {
  try {
    const { blockNumber } = req.params;

    if (!blockNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing blockNumber parameter',
      });
    }

    const block = await plasmaService.getBlock(BigInt(blockNumber));
    res.json({ success: true, block });
  } catch (error: any) {
    console.error('Get block error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create block endpoint
app.post('/api/create-block', async (req: Request, res: Response) => {
  try {
    const result = await plasmaService.createBlock();
    if (result) {
      res.json({ success: true, data: result });
    } else {
      res.json({ success: false, message: 'No pending transactions to create block' });
    }
  } catch (error: any) {
    console.error('Create block error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Force create block endpoint
app.post('/api/create-block-force', async (req: Request, res: Response) => {
  try {
    const { relayTransactions, reason } = req.body as {
      relayTransactions?: number;
      reason?: string;
    };

    const result = await plasmaService.createBlock(true); // force creation
    if (result) {
      res.json({
        success: true,
        data: {
          ...result,
          relayTransactions: relayTransactions || 0,
          reason: reason || 'force',
        },
      });
    } else {
      console.log('⚠️  No pending transactions to create block');
      res.json({
        success: false,
        message: 'No pending transactions to create block',
        pendingCount: 0,
      });
    }
  } catch (error: any) {
    console.error('Create block force error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get pending transactions endpoint
app.get('/api/pending-transactions', async (req: Request, res: Response) => {
  try {
    const pending = plasmaService.getPendingTransactions();
    res.json({ success: true, count: pending.length, transactions: pending });
  } catch (error: any) {
    console.error('Get pending transactions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Register ERC20 transfer endpoint
app.post('/api/register-erc20-transfer', async (req: Request, res: Response) => {
  try {
    const { txHash, from, to, amount, tokenAddress, blockNumber } = req.body as {
      txHash: Hex;
      from: Address;
      to: Address;
      amount: string;
      tokenAddress: Address;
      blockNumber: string;
    };

    if (!txHash || !from || !to || !amount || !tokenAddress || !blockNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: txHash, from, to, amount, tokenAddress, blockNumber',
      });
    }

    const result = await plasmaService.registerERC20Transfer(
      txHash,
      from,
      to,
      amount,
      tokenAddress,
      BigInt(blockNumber)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Register ERC20 transfer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scan ERC20 transfers endpoint
app.get('/api/scan-erc20-transfers', async (req: Request, res: Response) => {
  try {
    const { fromBlock } = req.query as { fromBlock?: string };

    const from = fromBlock ? BigInt(fromBlock) : 'latest';
    const transfers = await plasmaService.scanAndRegisterERC20Transfers(from);
    res.json({ success: true, transfers });
  } catch (error: any) {
    console.error('Scan ERC20 transfers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get accumulator value endpoint
app.get('/api/accumulator/value', (req: Request, res: Response) => {
  try {
    const accumulator = plasmaService.getAccumulatorValue();
    const size = plasmaService.getAccumulatorSize();
    res.json({
      success: true,
      accumulator,
      size,
    });
  } catch (error: any) {
    console.error('Get accumulator value error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add transaction hash to accumulator endpoint
app.post('/api/accumulator/add', async (req: Request, res: Response) => {
  try {
    const { txHash } = req.body as { txHash: Hex };

    if (!txHash) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: txHash',
      });
    }

    const result = await plasmaService.addToAccumulator(txHash);
    const accumulator = plasmaService.getAccumulatorValue();
    const size = plasmaService.getAccumulatorSize();

    res.json({
      success: true,
      added: result,
      accumulator,
      size,
    });
  } catch (error: any) {
    console.error('Add to accumulator error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Notify transaction from Relay (NEW)
app.post('/api/transactions/notify', async (req: Request, res: Response) => {
  try {
    const { type, txHash, from, to, token, amount, blockNumber } = req.body as {
      type: 'DEPOSIT' | 'TRANSFER' | 'WITHDRAWAL';
      txHash: Hex;
      from?: Address;
      to?: Address;
      token?: Address;
      amount?: string;
      blockNumber?: string;
    };

    if (!type || !txHash) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: type, txHash',
      });
    }

    console.log(`[Backend] 📨 Received transaction notification from Relay:`);
    console.log(`  Type: ${type}`);
    console.log(`  TxHash: ${txHash}`);
    if (from) console.log(`  From: ${from}`);
    if (to) console.log(`  To: ${to}`);
    if (amount) console.log(`  Amount: ${amount}`);

    // Add transaction to backend's pending pool for block submission
    const result = await plasmaService.addPendingTransaction({
      type,
      txHash,
      from,
      to,
      token,
      amount,
      blockNumber: blockNumber ? BigInt(blockNumber) : undefined,
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      message: 'Transaction added to pending pool',
      pendingCount: plasmaService.getPendingTransactions().length,
    });
  } catch (error: any) {
    console.error('Notify transaction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message,
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    path: req.path,
  });
});

// Store server instance
const server = app.listen(PORT, () => {
  console.log(`✅ Plasma Layer 2 server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API base URL: http://localhost:${PORT}/api`);
});

// Graceful shutdown handler
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} signal received: closing HTTP server`);

  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });

  // Force close after 3 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 3000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
