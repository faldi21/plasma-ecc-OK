import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { envConfig } from './config/env.js';
import { getPlasmaServiceUTXO } from './plasma/PlasmaServiceUTXO.js';
import type { Address, Hex } from 'viem';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const PORT = parseInt(envConfig.PORT || '3001', 10);
const plasmaService = getPlasmaServiceUTXO();

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'plasma-l2-backend-utxo', mode: 'UTXO' });
});

// Config endpoint - expose contract addresses
app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    mode: 'UTXO',
    ROOT_CHAIN_UTXO_ADDRESS: envConfig.ROOT_CHAIN_UTXO_ADDRESS,
    PLASMA_CHAIN_UTXO_ADDRESS: envConfig.PLASMA_CHAIN_UTXO_ADDRESS,
    L2_PLASMA_TOKEN_ADDRESS: envConfig.L2_PLASMA_TOKEN_ADDRESS,
    PLASMA_TOKEN_ADDRESS: envConfig.PLASMA_TOKEN_ADDRESS,
  });
});

// Get UTXO by ID
app.get('/api/utxo/:utxoId', async (req: Request, res: Response) => {
  try {
    const { utxoId } = req.params as { utxoId: Hex };

    if (!utxoId) {
      return res.status(400).json({
        success: false,
        error: 'Missing utxoId parameter',
      });
    }

    const utxo = await plasmaService.getUtxo(utxoId as Hex);
    if (!utxo) {
      return res.status(404).json({
        success: false,
        error: 'UTXO not found',
      });
    }

    res.json({ success: true, utxo });
  } catch (error: any) {
    console.error('Get UTXO error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user's UTXOs
app.get('/api/utxos/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params as { address: Address };

    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Missing address parameter',
      });
    }

    const utxos = await plasmaService.getUserUtxos(address as Address);
    res.json({ success: true, utxos, count: utxos.length });
  } catch (error: any) {
    console.error('Get user UTXOs error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user's unspent UTXOs
app.get('/api/unspent-utxos/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params as { address: Address };

    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Missing address parameter',
      });
    }

    const utxos = await plasmaService.getUnspentUtxos(address as Address);
    res.json({ success: true, utxos, count: utxos.length });
  } catch (error: any) {
    console.error('Get unspent UTXOs error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user's UTXO balance
app.get('/api/balance/:address/:token', async (req: Request, res: Response) => {
  try {
    const { address, token } = req.params as { address: Address; token: Address };

    if (!address || !token) {
      return res.status(400).json({
        success: false,
        error: 'Missing address or token parameter',
      });
    }

    const balance = await plasmaService.getUserBalance(address as Address, token as Address);
    res.json({ success: true, balance });
  } catch (error: any) {
    console.error('Get balance error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check if UTXO can be exited
app.get('/api/can-exit/:utxoId', async (req: Request, res: Response) => {
  try {
    const { utxoId } = req.params as { utxoId: Hex };

    if (!utxoId) {
      return res.status(400).json({
        success: false,
        error: 'Missing utxoId parameter',
      });
    }

    const result = await plasmaService.canExit(utxoId as Hex);
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('Can exit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get accumulator value
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

// Get accumulator elements
app.get('/api/accumulator/elements', (req: Request, res: Response) => {
  try {
    const elements = plasmaService.getAccumulatorElements();
    const size = plasmaService.getAccumulatorSize();
    res.json({
      success: true,
      elements,
      size,
    });
  } catch (error: any) {
    console.error('Get accumulator elements error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add to accumulator
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

// Generate witness for UTXO
app.get('/api/witness/:utxoId', async (req: Request, res: Response) => {
  try {
    const { utxoId } = req.params as { utxoId: Hex };

    if (!utxoId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: utxoId',
      });
    }

    const formattedUtxoId = utxoId.startsWith('0x') ? (utxoId as Hex) : (`0x${utxoId}` as Hex);
    const witness = await plasmaService.generateWitness(formattedUtxoId);

    if (!witness) {
      return res.status(404).json({
        success: false,
        error: 'UTXO not found in accumulator',
      });
    }

    res.json({
      success: true,
      utxoId: formattedUtxoId,
      witness,
    });
  } catch (error: any) {
    console.error('Generate witness error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Submit block
app.post('/api/submit-block', async (req: Request, res: Response) => {
  try {
    const { transactionCount } = req.body as { transactionCount?: number };

    const count = transactionCount || plasmaService.getAccumulatorSize();
    if (count === 0) {
      return res.json({
        success: false,
        message: 'No transactions to submit',
      });
    }

    const result = await plasmaService.submitBlock(count);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Submit block error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get current plasma block
app.get('/api/current-block', async (req: Request, res: Response) => {
  try {
    const blockNumber = await plasmaService.getCurrentBlock();
    res.json({ success: true, blockNumber: blockNumber.toString() });
  } catch (error: any) {
    console.error('Get current block error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Notify transaction from Relay (UTXO mode)
app.post('/api/transactions/notify', async (req: Request, res: Response) => {
  try {
    const { type, utxoId, txHash, from, to, token, amount, blockNumber } = req.body as {
      type: 'UTXO_DEPOSIT' | 'UTXO_TRANSFER' | 'UTXO_WITHDRAWAL';
      utxoId?: Hex;
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

    console.log(`[Backend UTXO] Received transaction notification from Relay:`);
    console.log(`  Type: ${type}`);
    console.log(`  UTXO ID: ${utxoId}`);
    console.log(`  TxHash: ${txHash}`);

    // Add to pending transactions for auto block submission
    if (utxoId) {
      const txType = type === 'UTXO_DEPOSIT' ? 'DEPOSIT' :
                     type === 'UTXO_TRANSFER' ? 'TRANSFER' : 'SPEND';

      await plasmaService.addPendingTransaction({
        utxoId,
        type: txType as 'DEPOSIT' | 'TRANSFER' | 'SPEND',
        user: from as Address,
        amount: amount ? BigInt(amount) : undefined,
      });
    }

    const stats = plasmaService.getStats();

    res.json({
      success: true,
      message: 'UTXO transaction added to pending pool',
      utxoId,
      pendingCount: stats.pendingCount,
    });
  } catch (error: any) {
    console.error('Notify transaction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get pending transactions
app.get('/api/pending', (req: Request, res: Response) => {
  try {
    const pending = plasmaService.getPendingTransactions();
    res.json({
      success: true,
      count: pending.length,
      transactions: pending,
    });
  } catch (error: any) {
    console.error('Get pending error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get block submission statistics
app.get('/api/stats', (req: Request, res: Response) => {
  try {
    const stats = plasmaService.getStats();
    res.json({
      success: true,
      ...stats,
    });
  } catch (error: any) {
    console.error('Get stats error:', error);
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
  console.log(`Plasma Layer 2 UTXO server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API base URL: http://localhost:${PORT}/api`);
});

// Graceful shutdown handler
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} signal received: closing HTTP server`);

  // Stop auto block submission
  plasmaService.stopAutoBlockSubmission();

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
