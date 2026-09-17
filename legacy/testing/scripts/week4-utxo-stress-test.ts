/**
 * Week 4: UTXO Stress Testing
 * Test real Plasma UTXO transfers under load
 *
 * Flow:
 * 1. Setup: Deposit ETH → Plasma tokens (UTXO creation)
 * 2. Stress: Transfer UTXOs between users in progressive load phases
 * 3. Measure: TPS, latency, and accumulator performance with real state changes
 *
 * Phases:
 * 1. Phase 1: 50 UTXO transfers (baseline)
 * 2. Phase 2: 100 UTXO transfers (2x)
 * 3. Phase 3: 200 UTXO transfers (4x)
 * 4. Phase 4: 500 UTXO transfers (10x)
 */

import { createPublicClient, createWalletClient, http, keccak256, encodePacked, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { getTimestamp, getDateString } from './utils.ts';

// Load .env file
dotenvConfig({ path: resolve(process.cwd(), '.env') });

interface UTXOStressPhase {
  phase: number;
  transferCount: number;
  batchSize: number;
  description: string;
}

interface UTXOPhaseResult {
  phase: number;
  totalTransfers: number;
  successfulTransfers: number;
  failedTransfers: number;
  totalTime: number;
  tps: number;
  avgLatency: number | null;
  minLatency: number | null;
  maxLatency: number | null;
  errors: Array<{ transfer: number; error: string }>;
  timestamp: string;
}

interface UTXO {
  utxoId: Hex;
  owner: Address;
  token: Address;
  amount: bigint;
  spent: boolean;
}

const UTXO_STRESS_PHASES: UTXOStressPhase[] = [
  { phase: 1, transferCount: 50, batchSize: 10, description: 'Baseline UTXO transfers' },
  { phase: 2, transferCount: 100, batchSize: 20, description: '2x UTXO transfers' },
  { phase: 3, transferCount: 200, batchSize: 50, description: '4x UTXO transfers' },
  { phase: 4, transferCount: 500, batchSize: 100, description: '10x UTXO transfers' },
];

interface Config {
  l2RpcUrl: string;
  plasmaChainUtxoAddress: Address;
  plasmaTokenAddress: Address;
  users: Array<{ address: Address; privateKey: Hex }>;
}

function loadConfig(): Config {
  const l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:8545';
  const plasmaChainUtxoAddress = (process.env.PLASMA_CHAIN_UTXO_ADDRESS || '0x2860763ac53e487b1521dfd6510f6780b2d86223') as Address;
  const plasmaTokenAddress = (process.env.L2_PLASMA_TOKEN_ADDRESS || '0x9E7088C23e5C0B2D02cD7886A1BDbC7FE8b71016') as Address;

// KREDENSIAL DIHAPUS: tiga kunci privat pernah tertulis literal di blok
// `users` di bawah. Kunci-kunci itu sudah dinonaktifkan dan dananya
// dipindahkan. Kunci sekarang dibaca dari environment dan tidak punya
// fallback -- skrip ini gagal dengan pesan jelas kalau env-nya kosong,
// bukan diam-diam memakai akun yang ter-commit.
  const requireUserKey = (slot: number): Hex => {
    const name = `STRESS_USER${slot}_PRIVATE_KEY`;
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `Missing required env var: ${name}. ` +
          'Kunci pengguna stress-test tidak lagi disimpan di berkas ini; ' +
          'set STRESS_USER1/2/3_PRIVATE_KEY di .env (yang di-gitignore).',
      );
    }
    return value as Hex;
  };

  const users = [
    {
      address: '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76' as Address,
      privateKey: requireUserKey(1),
    },
    {
      address: '0x62dc14Fe819A241e176ee6A813f51045d04A0cda' as Address,
      privateKey: requireUserKey(2),
    },
    {
      address: '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab' as Address,
      privateKey: requireUserKey(3),
    },
  ];

  return {
    l2RpcUrl,
    plasmaChainUtxoAddress,
    plasmaTokenAddress,
    users,
  };
}

async function getUnspentUtxos(
  publicClient: any,
  plasmaChainUtxoAbi: any,
  address: Address
): Promise<Hex[]> {
  try {
    const utxoIds = (await publicClient.readContract({
      address: process.env.PLASMA_CHAIN_UTXO_ADDRESS as Address,
      abi: plasmaChainUtxoAbi,
      functionName: 'getUserUtxos',
      args: [address],
    })) as Hex[];

    // Filter to only unspent UTXOs
    const unspentUtxos: Hex[] = [];
    for (const utxoId of utxoIds) {
      try {
        const utxoData = (await publicClient.readContract({
          address: process.env.PLASMA_CHAIN_UTXO_ADDRESS as Address,
          abi: plasmaChainUtxoAbi,
          functionName: 'utxos',
          args: [utxoId],
        })) as any;

        const spent = utxoData[5] as boolean;
        if (!spent) {
          unspentUtxos.push(utxoId);
        }
      } catch (error) {
        // Skip UTXOs that cause errors
        continue;
      }
    }

    return unspentUtxos;
  } catch (error) {
    console.warn(`Error getting UTXOs for ${address}:`, error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function getUtxoDetails(publicClient: any, plasmaChainUtxoAbi: any, utxoId: Hex): Promise<UTXO | null> {
  try {
    const result = (await publicClient.readContract({
      address: process.env.PLASMA_CHAIN_UTXO_ADDRESS as Address,
      abi: plasmaChainUtxoAbi,
      functionName: 'utxos',
      args: [utxoId],
    })) as [Hex, Address, Address, bigint, bigint, boolean];

    return {
      utxoId: result[0],
      owner: result[1],
      token: result[2],
      amount: result[3],
      spent: result[5],
    };
  } catch (error) {
    return null;
  }
}

async function executeUTXOPhase(
  config: Config,
  phase: UTXOStressPhase,
  publicClient: any,
  walletClients: any[],
  plasmaChainUtxoAbi: any
): Promise<UTXOPhaseResult> {
  console.log(`\n⏳ PHASE ${phase.phase}: ${phase.description}`);
  console.log(`   Transfers: ${phase.transferCount}`);
  console.log(`   Batch Size: ${phase.batchSize}`);
  console.log('');

  const startTime = Date.now();
  let successCount = 0;
  let failureCount = 0;
  const errors: Array<{ transfer: number; error: string }> = [];
  const latencies: number[] = [];

  const numBatches = Math.ceil(phase.transferCount / phase.batchSize);
  let transferIndex = 0;

  for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
    const batchStart = Date.now();
    const txsInBatch = Math.min(phase.batchSize, phase.transferCount - batchIdx * phase.batchSize);

    process.stdout.write(`   Batch ${batchIdx + 1}/${numBatches}: `);

    for (let i = 0; i < txsInBatch; i++) {
      try {
        const txStartTime = Date.now();

        // Rotate through users: A → B → C → A
        const senderIdx = transferIndex % 3;
        const recipientIdx = (transferIndex + 1) % 3;

        const sender = config.users[senderIdx];
        const recipient = config.users[recipientIdx];

        // Get sender's unspent UTXOs
        const utxoIds = await getUnspentUtxos(publicClient, plasmaChainUtxoAbi, sender.address);

        if (utxoIds.length === 0) {
          throw new Error(`No unspent UTXOs for ${sender.address}`);
        }

        // Get first unspent UTXO details (should be unspent since we filtered)
        const utxoId = utxoIds[0];
        const utxoDetails = await getUtxoDetails(publicClient, plasmaChainUtxoAbi, utxoId);

        if (!utxoDetails) {
          throw new Error(`UTXO ${utxoId.slice(0, 10)}... not found`);
        }

        // Create transfer: send half to recipient, half back as change
        const transferAmount = utxoDetails.amount / 2n;
        const changeAmount = utxoDetails.amount - transferAmount;

        // Sign transfer message
        const messageHash = keccak256(
          encodePacked(
            ['bytes32[]', 'address[]', 'uint256[]', 'uint256'],
            [[utxoId], [recipient.address, sender.address], [transferAmount, changeAmount], 0n]
          )
        );

        const senderAccount = privateKeyToAccount(sender.privateKey);
        const signature = await walletClients[senderIdx].signMessage({
          account: senderAccount,
          message: { raw: messageHash },
        });

        // Execute transfer on-chain
        const hash = await walletClients[senderIdx].writeContract({
          address: process.env.PLASMA_CHAIN_UTXO_ADDRESS as Address,
          abi: plasmaChainUtxoAbi,
          functionName: 'transferUtxo',
          args: [[utxoId], [recipient.address, sender.address], [transferAmount, changeAmount], signature],
        });

        await publicClient.waitForTransactionReceipt({ hash, timeout: 60000 });

        const txLatency = Date.now() - txStartTime;
        latencies.push(txLatency);
        successCount++;
        transferIndex++;

        if (transferIndex % 10 === 0) {
          process.stdout.write(`${transferIndex}..`);
        }
      } catch (error) {
        failureCount++;
        transferIndex++;
        errors.push({
          transfer: transferIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const batchTime = Date.now() - batchStart;
    const batchTps = (txsInBatch / (batchTime / 1000)).toFixed(2);
    process.stdout.write(` ${batchTps} TPS\n`);
  }

  console.log();
  const totalDuration = Date.now() - startTime;

  // Calculate statistics
  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : null;
  const minLatency = latencies.length > 0 ? Math.min(...latencies) : null;
  const tps = successCount > 0 ? (successCount / (totalDuration / 1000)).toFixed(2) : '0';

  const result: UTXOPhaseResult = {
    phase: phase.phase,
    totalTransfers: successCount + failureCount,
    successfulTransfers: successCount,
    failedTransfers: failureCount,
    totalTime: totalDuration,
    tps: parseFloat(tps as string),
    avgLatency,
    minLatency,
    maxLatency,
    errors,
    timestamp: getTimestamp(),
  };

  return result;
}

async function main(): Promise<void> {
  try {
    const config = loadConfig();

    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║      WEEK 4: UTXO STRESS TESTING - START            ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('🔍 Configuration:');
    console.log(`   L2 RPC: ${config.l2RpcUrl}`);
    console.log(`   PlasmaChainUTXO: ${config.plasmaChainUtxoAddress}`);
    console.log(`   PlasmaToken: ${config.plasmaTokenAddress}`);
    console.log(`   Users: ${config.users.length}\n`);

    // Load ABI
    const plasmaChainUtxoAbi = JSON.parse(
      readFileSync(resolve(process.cwd(), 'backend/abi/PlasmaChainUTXO.json'), 'utf-8')
    ).abi;

    // Setup clients
    const publicClient = createPublicClient({ transport: http(config.l2RpcUrl) });
    const walletClients = config.users.map((user) =>
      createWalletClient({
        account: privateKeyToAccount(user.privateKey),
        transport: http(config.l2RpcUrl),
      })
    );

    const allPhaseResults: UTXOPhaseResult[] = [];

    console.log('🚀 Executing UTXO transfers and monitoring accumulator...\n');

    for (const phase of UTXO_STRESS_PHASES) {
      const phaseResult = await executeUTXOPhase(config, phase, publicClient, walletClients, plasmaChainUtxoAbi);
      allPhaseResults.push(phaseResult);

      // Summary for this phase
      console.log(`\n   📊 Phase ${phase.phase} Summary:`);
      console.log(`      Total: ${phaseResult.totalTransfers}`);
      console.log(
        `      Success: ${phaseResult.successfulTransfers} (${((phaseResult.successfulTransfers / phaseResult.totalTransfers) * 100).toFixed(2)}%)`
      );
      console.log(`      Failed: ${phaseResult.failedTransfers}`);
      console.log(`      TPS: ${phaseResult.tps.toFixed(2)}`);
      console.log(`      Avg Latency: ${phaseResult.avgLatency ?? 'N/A'} ms`);
    }

    // Save results
    const timestamp = getDateString();
    const resultsDir = resolve(process.cwd(), 'data', 'research', 'benchmarks');
    mkdirSync(resultsDir, { recursive: true });

    // Save detailed results for each phase
    for (const result of allPhaseResults) {
      const phasePath = resolve(resultsDir, `utxo-stress-phase${result.phase}-${timestamp}.json`);
      writeFileSync(phasePath, JSON.stringify(result, null, 2));
    }

    // Save summary
    const summaryPath = resolve(resultsDir, `utxo-stress-summary-${timestamp}.json`);
    writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          timestamp: getTimestamp(),
          totalPhases: allPhaseResults.length,
          phases: allPhaseResults,
          summary: {
            maxTps: Math.max(...allPhaseResults.map((p) => p.tps)),
            minTps: Math.min(...allPhaseResults.map((p) => p.tps)),
            avgTps: (allPhaseResults.reduce((sum, p) => sum + p.tps, 0) / allPhaseResults.length).toFixed(2),
            totalTransfers: allPhaseResults.reduce((sum, p) => sum + p.totalTransfers, 0),
            totalSuccessful: allPhaseResults.reduce((sum, p) => sum + p.successfulTransfers, 0),
            totalFailed: allPhaseResults.reduce((sum, p) => sum + p.failedTransfers, 0),
            overallSuccessRate: (
              (allPhaseResults.reduce((sum, p) => sum + p.successfulTransfers, 0) /
                allPhaseResults.reduce((sum, p) => sum + p.totalTransfers, 0)) *
              100
            ).toFixed(2),
          },
        },
        null,
        2
      )
    );

    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║           📊 UTXO STRESS TEST COMPLETE             ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('📈 Overall Summary:');
    console.log(`   Total Phases: ${allPhaseResults.length}`);
    console.log(`   Total Transfers: ${allPhaseResults.reduce((sum, p) => sum + p.totalTransfers, 0)}`);
    console.log(`   Successful: ${allPhaseResults.reduce((sum, p) => sum + p.successfulTransfers, 0)}`);
    console.log(`   Failed: ${allPhaseResults.reduce((sum, p) => sum + p.failedTransfers, 0)}`);
    console.log(`   Min TPS: ${Math.min(...allPhaseResults.map((p) => p.tps)).toFixed(2)}`);
    console.log(`   Max TPS: ${Math.max(...allPhaseResults.map((p) => p.tps)).toFixed(2)}`);
    console.log(`   Avg TPS: ${(allPhaseResults.reduce((sum, p) => sum + p.tps, 0) / allPhaseResults.length).toFixed(2)}`);
    console.log(`\n📁 Results saved: ${summaryPath}\n`);
  } catch (error) {
    console.error('❌ UTXO stress test failed:', error);
    process.exit(1);
  }
}

main();
