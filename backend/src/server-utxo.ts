import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { envConfig } from './config/env.js';
import { getPlasmaServiceUTXO, type SerializedPlasmaState } from './plasma/PlasmaServiceUTXO.js';
import { tpsRunner, type TpsTestConfig } from './plasma/TpsTestRunner.js';
import { runFullCalibration } from './plasma/CryptoCalibration.js';
import { runProofSizeValidation } from './plasma/ProofSizeValidator.js';
import { runFullVerifyGasMeasurement } from './plasma/VerifyGasMeasurement.js';
import type { Address, Hex } from 'viem';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const PORT = parseInt(envConfig.PORT || '3001', 10);

// State file configuration - use root /data directory (same as Anvil and relay state)
const STATE_DIR = resolve(process.cwd(), '..', 'data');
const STATE_FILE = resolve(STATE_DIR, 'plasma-state.json');
const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

// Ensure data directory exists
if (!existsSync(STATE_DIR)) {
  mkdirSync(STATE_DIR, { recursive: true });
  console.log(`[Persistence] Created data directory: ${STATE_DIR}`);
}

// Initialize plasma service
const plasmaService = getPlasmaServiceUTXO();

// Load saved state if exists
function loadState(): boolean {
  try {
    if (!existsSync(STATE_FILE)) {
      console.log('[Persistence] No saved state found, starting fresh');
      return false;
    }

    const data = readFileSync(STATE_FILE, 'utf-8');
    const state = JSON.parse(data) as { version: number; savedAt: string; plasma: SerializedPlasmaState };

    console.log(`[Persistence] Loading state from ${STATE_FILE}`);
    console.log(`  - Saved at: ${state.savedAt}`);

    const success = plasmaService.restore(state.plasma);
    if (success) {
      console.log('[Persistence] State restored successfully');
    }
    return success;
  } catch (error) {
    console.error('[Persistence] Error loading state:', error);
    return false;
  }
}

// Save current state
function saveState(): boolean {
  try {
    if (!plasmaService.hasData()) {
      // Don't save if no data
      return true;
    }

    const state = {
      version: 1,
      savedAt: new Date().toISOString(),
      plasma: plasmaService.serialize(),
    };

    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    console.log(`[Persistence] State saved to ${STATE_FILE}`);
    console.log(`  - Accumulator elements: ${plasmaService.getAccumulatorSize()}`);
    return true;
  } catch (error) {
    console.error('[Persistence] Error saving state:', error);
    return false;
  }
}

// Load state on startup
loadState();

// Setup auto-save timer
let autoSaveTimer: NodeJS.Timeout | null = null;

function startAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
  }

  autoSaveTimer = setInterval(() => {
    // Skip auto-save while TPS benchmark is running — writeFileSync blocks the event loop
    // and pollutes latency measurements with periodic 500-2000ms stalls.
    const tpsStatus = tpsRunner.getStatus().status;
    if (tpsStatus === 'funding' || tpsStatus === 'running') return;

    if (plasmaService.hasData()) {
      saveState();
    }
  }, AUTO_SAVE_INTERVAL);

  console.log(`[Persistence] Auto-save enabled (interval: ${AUTO_SAVE_INTERVAL}ms, pauses during TPS test)`);
}

function stopAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }
}

// Start auto-save
startAutoSave();

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

// Transfer UTXO on L2
app.post('/api/utxo/transfer', async (req: Request, res: Response) => {
  try {
    const { from, to, token, amount, nonce, signature } = req.body as {
      from: Address;
      to: Address;
      token: Address;
      amount: string;
      nonce: number;
      signature: Hex;
    };

    if (!from || !to || !token || !amount || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: from, to, token, amount, signature',
      });
    }

    console.log(`[Transfer] Processing transfer from ${from} to ${to}, amount: ${amount}`);

    // Execute transfer via PlasmaService
    const result = await plasmaService.transferUtxo(
      from,
      to,
      token,
      BigInt(amount),
      signature
    );

    res.json({
      success: true,
      txHash: result.txHash,
      outputUtxoIds: result.outputUtxoIds,
      inputUtxoIds: result.inputUtxoIds,
    });
  } catch (error: any) {
    console.error('Transfer error:', error);
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
  const { utxoId } = req.params as { utxoId: Hex };
  const { blockNumber: blockNumberParam } = req.query as { blockNumber?: string };

  if (!utxoId) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: utxoId',
    });
  }

  try {
    const formattedUtxoId = utxoId.startsWith('0x') ? (utxoId as Hex) : (`0x${utxoId}` as Hex);

    // Get the block number where this UTXO was added to accumulator
    const currentBlock = await plasmaService.getCurrentBlock();
    const requestedBlock = blockNumberParam ? BigInt(blockNumberParam) : null;
    const resolvedBlock = requestedBlock ?? await plasmaService.getUtxoBlockNumber(formattedUtxoId);

    let finalBlock = resolvedBlock ? BigInt(resolvedBlock) : currentBlock;
    if (finalBlock <= 0n || finalBlock > currentBlock) {
      finalBlock = currentBlock > 0n ? currentBlock : 1n;
    }

    const witness = await plasmaService.generateWitnessForBlock(formattedUtxoId, finalBlock);

    return res.json({
      success: true,
      utxoId: formattedUtxoId,
      witness,
      blockNumber: finalBlock.toString(),
    });
  } catch (error: any) {
    const message = error?.message || 'Generate witness error';
    if (message.includes('Element not found')) {
      return res.status(404).json({
        success: false,
        error: 'UTXO not found in accumulator',
      });
    }
    console.error('Generate witness error:', error);
    return res.status(500).json({ success: false, error: message });
  }
});

// Aggregate UTXOs for withdrawal (operator via backend)
app.post('/api/withdraw/aggregate', async (req: Request, res: Response) => {
  try {
    const { userAddress, tokenAddress, amount, signature } = req.body as {
      userAddress: Address;
      tokenAddress: Address;
      amount: string;
      signature: Hex;
    };

    if (!userAddress || !tokenAddress || !amount || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userAddress, tokenAddress, amount, signature',
      });
    }

    const result = await plasmaService.aggregateForWithdrawal(
      userAddress,
      tokenAddress,
      BigInt(amount),
      signature
    );

    res.json({
      success: true,
      data: {
        ...result,
        changeAmount: result.changeAmount.toString(),
      },
    });
  } catch (error: any) {
    console.error('Aggregate withdrawal error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create L2 block (operator via backend)
app.post('/api/withdraw/create-block', async (_req: Request, res: Response) => {
  try {
    const result = await plasmaService.createL2Block();
    res.json({
      success: true,
      data: {
        ...result,
        currentBlock: result.currentBlock.toString(),
      },
    });
  } catch (error: any) {
    console.error('Create L2 block error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Register Exit UTXO on L1 (operator via backend)
app.post('/api/withdraw/register-exit-utxo', async (req: Request, res: Response) => {
  try {
    const { exitUtxoId, userAddress, tokenAddress, amount, blockNumber } = req.body as {
      exitUtxoId: Hex;
      userAddress: Address;
      tokenAddress: Address;
      amount: string;
      blockNumber: string;
    };

    if (!exitUtxoId || !userAddress || !tokenAddress || !amount || !blockNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: exitUtxoId, userAddress, tokenAddress, amount, blockNumber',
      });
    }

    const hash = await plasmaService.registerExitUtxo(
      exitUtxoId,
      userAddress,
      tokenAddress,
      BigInt(amount),
      BigInt(blockNumber)
    );

    res.json({ success: true, data: { txHash: hash } });
  } catch (error: any) {
    console.error('Register Exit UTXO error:', error);
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

// ============ PERSISTENCE ENDPOINTS ============

// Get persistence status
app.get('/api/persistence/status', (req: Request, res: Response) => {
  try {
    const hasStateFile = existsSync(STATE_FILE);
    const hasData = plasmaService.hasData();

    res.json({
      success: true,
      stateFile: STATE_FILE,
      hasStateFile,
      hasData,
      accumulatorSize: plasmaService.getAccumulatorSize(),
      autoSaveInterval: AUTO_SAVE_INTERVAL,
    });
  } catch (error: any) {
    console.error('Get persistence status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual save state
app.post('/api/persistence/save', (req: Request, res: Response) => {
  try {
    const success = saveState();
    res.json({
      success,
      message: success ? 'State saved successfully' : 'Failed to save state',
      stateFile: STATE_FILE,
    });
  } catch (error: any) {
    console.error('Manual save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual load state (reload from file)
app.post('/api/persistence/load', (req: Request, res: Response) => {
  try {
    const success = loadState();
    res.json({
      success,
      message: success ? 'State loaded successfully' : 'No state file found or failed to load',
      stateFile: STATE_FILE,
      accumulatorSize: plasmaService.getAccumulatorSize(),
    });
  } catch (error: any) {
    console.error('Manual load error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export state (download backup)
app.get('/api/persistence/export', (req: Request, res: Response) => {
  try {
    const state = {
      version: 1,
      exportedAt: new Date().toISOString(),
      plasma: plasmaService.serialize(),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=plasma-state-backup-${Date.now()}.json`);
    res.json(state);
  } catch (error: any) {
    console.error('Export state error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ TPS TEST ENDPOINTS ============

app.post('/api/test/tps/start', async (req: Request, res: Response) => {
  try {
    const { totalTransactions, concurrency, amountPerTx, batchSize, createBlockEvery, revertAfter, flushPendingChunkSize, mode } = req.body as Partial<TpsTestConfig>;

    if (!totalTransactions || !concurrency || !amountPerTx) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: totalTransactions, concurrency, amountPerTx',
      });
    }

    if (totalTransactions < 1 || totalTransactions > 50000) {
      return res.status(400).json({
        success: false,
        error: 'totalTransactions must be between 1 and 50000',
      });
    }

    if (concurrency < 1 || concurrency > 3) {
      return res.status(400).json({
        success: false,
        error: 'concurrency must be between 1 and 3',
      });
    }

    if (batchSize !== undefined && (batchSize < 1 || batchSize > 500)) {
      return res.status(400).json({
        success: false,
        error: 'batchSize must be between 1 and 500',
      });
    }

    if (mode && mode !== 'ecc' && mode !== 'merkle') {
      return res.status(400).json({ success: false, error: "mode must be 'ecc' or 'merkle'" });
    }

    const config: TpsTestConfig = { totalTransactions, concurrency, amountPerTx, batchSize, createBlockEvery, revertAfter, flushPendingChunkSize, mode };
    await tpsRunner.start(config);
    res.json({ success: true, message: 'TPS test started', config });
  } catch (error: any) {
    console.error('TPS test start error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/test/tps/status', (_req: Request, res: Response) => {
  try {
    const status = tpsRunner.getStatus();
    res.json({ success: true, ...status });
  } catch (error: any) {
    console.error('TPS test status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/test/tps/stop', (_req: Request, res: Response) => {
  try {
    tpsRunner.stop();
    res.json({ success: true, message: 'Stop signal sent' });
  } catch (error: any) {
    console.error('TPS test stop error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/test/tps/history', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, history: tpsRunner.getHistory() });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Multi-run wrapper: runs the same TPS config N times sequentially.
// Each run produces a separate history entry; aggregate stats computed at end.
let multiRunInProgress = false;
let multiRunProgress: { current: number; total: number; runs: any[]; config: any } | null = null;

app.post('/api/test/tps/start-multi', async (req: Request, res: Response) => {
  if (multiRunInProgress) {
    return res.status(409).json({ success: false, error: 'Multi-run already in progress' });
  }
  const cfg = req.body as Partial<TpsTestConfig> & { repeats?: number; labelPrefix?: string };
  const repeats = Math.max(1, Math.min(50, Math.floor(cfg.repeats ?? 10)));
  const labelPrefix = cfg.labelPrefix || `multirun-${cfg.mode || 'ecc'}-t${cfg.totalTransactions}`;
  if (!cfg.totalTransactions || !cfg.concurrency || !cfg.amountPerTx) {
    return res.status(400).json({ success: false, error: 'Missing required TPS config fields' });
  }
  multiRunInProgress = true;
  multiRunProgress = { current: 0, total: repeats, runs: [], config: cfg };

  // Respond immediately, run in background
  res.json({ success: true, message: 'Multi-run started in background', repeats });

  (async () => {
    const INTER_RUN_DELAY_MS = 1500;  // give Anvil/backend breathing room between runs
    const MAX_POLL_MS = 180_000;       // hard ceiling: bail if a single run exceeds 3 min
    try {
      for (let i = 0; i < repeats; i++) {
        const single: TpsTestConfig = {
          totalTransactions: cfg.totalTransactions!,
          concurrency: cfg.concurrency!,
          amountPerTx: cfg.amountPerTx!,
          batchSize: cfg.batchSize,
          createBlockEvery: cfg.createBlockEvery,
          revertAfter: cfg.revertAfter,
          flushPendingChunkSize: cfg.flushPendingChunkSize,
          mode: cfg.mode,
        };
        try {
          await tpsRunner.start(single);
        } catch (startErr: any) {
          console.warn(`[MultiRun] start() failed at ${i + 1}/${repeats}:`, startErr.message);
          await new Promise(r => setTimeout(r, INTER_RUN_DELAY_MS));
          continue;
        }
        // Poll until done OR max poll time reached (bail-out safeguard)
        const pollStart = Date.now();
        while (true) {
          const st = tpsRunner.getStatus().status;
          if (st === 'complete' || st === 'error') break;
          if (Date.now() - pollStart > MAX_POLL_MS) {
            console.error(`[MultiRun] ${i + 1}/${repeats} EXCEEDED MAX POLL TIME — abandoning, requesting stop`);
            tpsRunner.stop();
            await new Promise(r => setTimeout(r, 2000));
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        }
        const result = tpsRunner.getStatus().result;
        if (result?.id) {
          tpsRunner.setLabel(result.id, `${labelPrefix}-r${i + 1}`);
        }
        multiRunProgress!.runs.push(result);
        multiRunProgress!.current = i + 1;
        const tps = result?.tps ?? 0;
        const status = tpsRunner.getStatus().status;
        console.log(`[MultiRun] ${i + 1}/${repeats} ${status === 'complete' ? '✓' : '✗'} TPS=${tps.toFixed(2)}`);

        // Inter-run delay — let Anvil/backend recover before next iteration
        if (i < repeats - 1) {
          await new Promise(r => setTimeout(r, INTER_RUN_DELAY_MS));
        }
      }
    } catch (err: any) {
      console.error('[MultiRun] fatal error:', err.message);
    } finally {
      multiRunInProgress = false;
    }
  })();
});

app.get('/api/test/tps/start-multi/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    inProgress: multiRunInProgress,
    progress: multiRunProgress,
  });
});

app.patch('/api/test/tps/history/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { label } = req.body as { label: string };
    if (!label) return res.status(400).json({ success: false, error: 'Missing label' });
    const ok = tpsRunner.setLabel(id, label);
    if (!ok) return res.status(404).json({ success: false, error: 'Result not found' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/test/tps/history/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const ok = tpsRunner.deleteResult(id);
    if (!ok) return res.status(404).json({ success: false, error: 'Result not found' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/test/tps/history', (_req: Request, res: Response) => {
  try {
    tpsRunner.clearHistory();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ CRYPTO CALIBRATION (paper Table 3 data) ============

let calibrationCache: { timestamp: number; data: any } | null = null;
let calibrationInProgress = false;

app.post('/api/test/calibration/run', async (req: Request, res: Response) => {
  if (calibrationInProgress) {
    return res.status(409).json({ success: false, error: 'Calibration already running' });
  }
  if (tpsRunner.getStatus().status === 'funding' || tpsRunner.getStatus().status === 'running') {
    return res.status(409).json({ success: false, error: 'TPS test running — wait for it to finish first' });
  }

  const runs = Math.max(1, Math.min(50, parseInt((req.query.runs as string) || (req.body?.runs as string) || '10', 10)));
  const blockPendingTarget = Math.max(1, Math.min(500, parseInt((req.query.blockPending as string) || (req.body?.blockPending as string) || '100', 10)));

  calibrationInProgress = true;
  try {
    const result = await runFullCalibration({ runs, blockPendingTarget });
    const serialized = {
      timestamp: Date.now(),
      runs,
      blockPendingTarget,
      ecc: result.ecc,
      merkle: result.merkle,
    };
    calibrationCache = { timestamp: Date.now(), data: serialized };
    res.json({ success: true, data: serialized });
  } catch (error: any) {
    console.error('[Calibration] error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    calibrationInProgress = false;
  }
});

app.get('/api/test/calibration/latest', (_req: Request, res: Response) => {
  if (!calibrationCache) {
    return res.json({ success: true, data: null });
  }
  res.json({ success: true, data: calibrationCache.data });
});

// ============ PROOF SIZE EMPIRICAL VALIDATION (paper Table 2 data) ============

let verifyGasCache: { timestamp: number; data: any } | null = null;
let verifyGasInProgress = false;

app.post('/api/test/verify-gas/run', async (req: Request, res: Response) => {
  if (verifyGasInProgress) {
    return res.status(409).json({ success: false, error: 'Verify-gas measurement already running' });
  }
  if (tpsRunner.getStatus().status === 'funding' || tpsRunner.getStatus().status === 'running') {
    return res.status(409).json({ success: false, error: 'TPS test running — wait first' });
  }
  const runs = Math.max(1, Math.min(50, parseInt((req.query.runs as string) || (req.body?.runs as string) || '10', 10)));
  const merkleProofLength = Math.max(1, Math.min(40, parseInt((req.query.proofLength as string) || (req.body?.merkleProofLength as string) || '20', 10)));

  verifyGasInProgress = true;
  try {
    const result = await runFullVerifyGasMeasurement({ runs, merkleProofLength });
    const serialized = { timestamp: Date.now(), runs, merkleProofLength, ecc: result.ecc, merkle: result.merkle };
    verifyGasCache = { timestamp: Date.now(), data: serialized };
    res.json({ success: true, data: serialized });
  } catch (error: any) {
    console.error('[VerifyGas] error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    verifyGasInProgress = false;
  }
});

app.get('/api/test/verify-gas/latest', (_req: Request, res: Response) => {
  res.json({ success: true, data: verifyGasCache?.data || null });
});

app.get('/api/test/proof-size-validation', (req: Request, res: Response) => {
  try {
    const nsParam = (req.query.ns as string) || '10,100,500,1000';
    const ns = nsParam
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0 && n <= 1_000_000);

    if (ns.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid ns parameter. Provide comma-separated positive integers.' });
    }

    const data = runProofSizeValidation(ns);
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('[ProofSizeValidation] error:', error);
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

  // Stop auto-save
  stopAutoSave();

  // Save state before shutdown
  console.log('[Persistence] Saving state before shutdown...');
  saveState();

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

// Also handle uncaught exceptions by saving state
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  saveState();
  process.exit(1);
});
