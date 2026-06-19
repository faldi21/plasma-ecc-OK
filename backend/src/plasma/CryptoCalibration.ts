import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  keccak256,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { envConfig } from '../config/env.js'
import { plasmaChainUtxoAbi as plasmaChainUtxoAbiEcc, plasmaChainUtxoMerkleAbi } from '../config/abis.js'
import crypto from 'crypto'

export type AccumulatorMode = 'ecc' | 'merkle'

/** Aggregated stats for repeated runs. mean/std/min/max in gas units (bigint or number for std). */
export interface AggregatedGas {
  mean: string   // bigint serialized
  std: string    // float (gas)
  min: string    // bigint
  max: string    // bigint
  runs: number
  samples: string[]   // raw sample values (bigint serialized) for reproducibility
}

export interface CalibrationResult {
  mode: AccumulatorMode
  contractAddress: Address
  deposit: AggregatedGas
  transfer: AggregatedGas
  withdrawal: AggregatedGas
  blockSubmission: AggregatedGas
  blockPendingTarget: number
  runs: number
  baseline: string  // implementation reference for the paper
}

const l2Url = envConfig.L2_RPC_URL || 'http://localhost:8545'
const tokenAddr = envConfig.L2_PLASMA_TOKEN_ADDRESS as Address
const BASELINE_IMPL = 'OpenZeppelin Contracts v5.5.0 (MerkleTree.Bytes32PushTree, depth=20, commutative keccak256)'

const l2Chain = {
  id: 31337,
  name: 'Plasma L2',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: { default: { http: [l2Url] }, public: { http: [l2Url] } },
} as const

const publicClient = createPublicClient({ chain: l2Chain, transport: http(l2Url) })
const operatorAccount = privateKeyToAccount(envConfig.L2_OPERATOR_PRIVATE_KEY)
const operatorClient = createWalletClient({ account: operatorAccount, chain: l2Chain, transport: http(l2Url) })

function getContractInfo(mode: AccumulatorMode): { addr: Address; abi: any } {
  const addr = (mode === 'merkle'
    ? envConfig.PLASMA_CHAIN_UTXO_MERKLE_ADDRESS
    : envConfig.PLASMA_CHAIN_UTXO_ADDRESS) as Address
  if (!addr) throw new Error(`No contract address for mode '${mode}' in .env`)
  const abi = mode === 'merkle' ? plasmaChainUtxoMerkleAbi : plasmaChainUtxoAbiEcc
  return { addr, abi }
}

function freshEphemeralUser() {
  const pk = ('0x' + crypto.randomBytes(32).toString('hex')) as Hex
  return privateKeyToAccount(pk)
}

async function measureGas(hash: Hex): Promise<bigint> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new Error(`Tx reverted: ${hash}`)
  }
  return receipt.gasUsed
}

async function takeSnapshot(): Promise<Hex> {
  return await publicClient.request({ method: 'evm_snapshot' as any, params: [] as any }) as Hex
}

async function revertSnapshot(id: Hex): Promise<void> {
  await publicClient.request({ method: 'evm_revert' as any, params: [id] as any })
}

async function fundEphemeral(addr: Address): Promise<void> {
  try {
    await publicClient.request({
      method: 'anvil_setBalance' as any,
      params: [addr, '0x56BC75E2D63100000'] as any, // 100 ETH
    })
  } catch {}
}

/**
 * Run a measurement function in an isolated state snapshot.
 * Whatever the function does is reverted afterward, ensuring identical
 * starting conditions for each repeated run.
 */
async function measureIsolated<T>(fn: () => Promise<T>): Promise<T> {
  const snap = await takeSnapshot()
  try {
    return await fn()
  } finally {
    try { await revertSnapshot(snap) } catch {}
  }
}

/** Aggregate an array of bigint samples into mean/std/min/max. */
function aggregate(samples: bigint[]): AggregatedGas {
  if (samples.length === 0) {
    return { mean: '0', std: '0', min: '0', max: '0', runs: 0, samples: [] }
  }
  const sum = samples.reduce((a, b) => a + b, 0n)
  const meanBig = sum / BigInt(samples.length)
  const meanNum = Number(meanBig)
  let variance = 0
  for (const s of samples) {
    const diff = Number(s) - meanNum
    variance += diff * diff
  }
  variance /= samples.length
  const std = Math.sqrt(variance)
  let min = samples[0], max = samples[0]
  for (const s of samples) {
    if (s < min) min = s
    if (s > max) max = s
  }
  return {
    mean: meanBig.toString(),
    std: std.toFixed(2),
    min: min.toString(),
    max: max.toString(),
    runs: samples.length,
    samples: samples.map(s => s.toString()),
  }
}

/**
 * Calibrate a single mode with N repeated runs.
 *
 * Each operation (deposit, transfer, withdrawal, block submission) is measured
 * IN ISOLATION: snapshot → setup → measure → revert. This gives identical state
 * conditions per run and per operation, eliminating cross-contamination.
 *
 * Block submission uses a FIXED pending count (default 100) via
 * createDepositUtxoBatch for reproducibility.
 */
export async function calibrateMode(
  mode: AccumulatorMode,
  options: { runs?: number; blockPendingTarget?: number } = {}
): Promise<CalibrationResult> {
  const runs = options.runs ?? 10
  const blockPendingTarget = options.blockPendingTarget ?? 100
  const { addr, abi } = getContractInfo(mode)

  console.log(`[Calibration ${mode.toUpperCase()}] starting: runs=${runs}, blockPendingTarget=${blockPendingTarget}`)

  const depositSamples: bigint[] = []
  const transferSamples: bigint[] = []
  const withdrawalSamples: bigint[] = []
  const blockSubmissionSamples: bigint[] = []

  for (let r = 0; r < runs; r++) {
    // ===== Measurement 1: DEPOSIT =====
    const depositGas = await measureIsolated(async () => {
      const user = freshEphemeralUser()
      await fundEphemeral(user.address)
      const depositId = ('0x' + crypto.randomBytes(32).toString('hex')) as Hex
      const hash = await operatorClient.writeContract({
        address: addr, abi,
        functionName: 'createDepositUtxo',
        args: [depositId, user.address, tokenAddr, parseEther('100')],
        gas: 50_000_000n,
      } as any)
      return await measureGas(hash)
    })
    depositSamples.push(depositGas)

    // ===== Measurement 2: TRANSFER =====
    const transferGas = await measureIsolated(async () => {
      const user = freshEphemeralUser()
      const receiver = freshEphemeralUser()
      await fundEphemeral(user.address)
      const userClient = createWalletClient({ account: user, chain: l2Chain, transport: http(l2Url) })
      // Setup: deposit first so user has a UTXO to spend
      const depositId = ('0x' + crypto.randomBytes(32).toString('hex')) as Hex
      const setupHash = await operatorClient.writeContract({
        address: addr, abi,
        functionName: 'createDepositUtxo',
        args: [depositId, user.address, tokenAddr, parseEther('100')],
        gas: 50_000_000n,
      } as any)
      await measureGas(setupHash)
      // Measured op
      const hash = await userClient.writeContract({
        address: addr, abi,
        functionName: 'transferUtxo',
        args: [[depositId], [receiver.address], [parseEther('100')], '0x'],
        gas: 50_000_000n,
      } as any)
      return await measureGas(hash)
    })
    transferSamples.push(transferGas)

    // ===== Measurement 3: WITHDRAWAL =====
    const withdrawalGas = await measureIsolated(async () => {
      const user = freshEphemeralUser()
      await fundEphemeral(user.address)
      // Setup: deposit so user has UTXO
      const depositId = ('0x' + crypto.randomBytes(32).toString('hex')) as Hex
      const setupHash = await operatorClient.writeContract({
        address: addr, abi,
        functionName: 'createDepositUtxo',
        args: [depositId, user.address, tokenAddr, parseEther('100')],
        gas: 50_000_000n,
      } as any)
      await measureGas(setupHash)
      // User signs withdrawal request
      const userNonce = await publicClient.readContract({
        address: addr, abi,
        functionName: 'nonces',
        args: [user.address],
      } as any) as bigint
      const wdMessageHash = keccak256(encodePacked(
        ['address', 'address', 'uint256', 'string', 'uint256'],
        [user.address, tokenAddr, parseEther('100'), 'AGGREGATE_WITHDRAW', userNonce]
      ))
      const signature = await user.signMessage({ message: { raw: wdMessageHash } })
      // Measured op
      const hash = await operatorClient.writeContract({
        address: addr, abi,
        functionName: 'aggregateForWithdrawal',
        args: [user.address, tokenAddr, parseEther('100'), signature],
        gas: 50_000_000n,
      } as any)
      return await measureGas(hash)
    })
    withdrawalSamples.push(withdrawalGas)

    // ===== Measurement 4: BLOCK SUBMISSION (fixed n) =====
    const blockGas = await measureIsolated(async () => {
      const user = freshEphemeralUser()
      // Funding via createDepositUtxoBatch: exactly N deposits in 1 tx
      const ids: Hex[] = []
      const users: Address[] = []
      const amounts: bigint[] = []
      for (let i = 0; i < blockPendingTarget; i++) {
        ids.push(('0x' + crypto.randomBytes(32).toString('hex')) as Hex)
        users.push(user.address)
        amounts.push(parseEther('1'))
      }
      const fundHash = await operatorClient.writeContract({
        address: addr, abi,
        functionName: 'createDepositUtxoBatch',
        args: [ids, users, tokenAddr, amounts],
        gas: 280_000_000n,
      } as any)
      await measureGas(fundHash)
      // Verify exact pending count
      const pending = await publicClient.readContract({
        address: addr, abi,
        functionName: 'getPendingUtxoCount',
      } as any) as bigint
      if (Number(pending) !== blockPendingTarget) {
        console.warn(`[Calibration ${mode}] pending mismatch: expected=${blockPendingTarget}, actual=${pending}`)
      }
      // Measured op
      const hash = await operatorClient.writeContract({
        address: addr, abi,
        functionName: 'createBlock',
        gas: 280_000_000n,
      } as any)
      return await measureGas(hash)
    })
    blockSubmissionSamples.push(blockGas)

    console.log(`[Calibration ${mode}] run ${r + 1}/${runs} done`)
  }

  return {
    mode,
    contractAddress: addr,
    deposit: aggregate(depositSamples),
    transfer: aggregate(transferSamples),
    withdrawal: aggregate(withdrawalSamples),
    blockSubmission: aggregate(blockSubmissionSamples),
    blockPendingTarget,
    runs,
    baseline: BASELINE_IMPL,
  }
}

export async function runFullCalibration(options: { runs?: number; blockPendingTarget?: number } = {}): Promise<{
  ecc: CalibrationResult
  merkle: CalibrationResult
}> {
  const opts = { runs: options.runs ?? 10, blockPendingTarget: options.blockPendingTarget ?? 100 }
  console.log(`[Calibration] runs=${opts.runs}, blockPendingTarget=${opts.blockPendingTarget}`)
  console.log('[Calibration] Starting ECC mode...')
  const ecc = await calibrateMode('ecc', opts)
  console.log('[Calibration] Starting Merkle mode...')
  const merkle = await calibrateMode('merkle', opts)
  return { ecc, merkle }
}
