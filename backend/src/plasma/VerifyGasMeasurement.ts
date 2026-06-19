import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { envConfig } from '../config/env.js'
import { plasmaChainUtxoAbi as plasmaChainUtxoAbiEcc, plasmaChainUtxoMerkleAbi } from '../config/abis.js'
import crypto from 'crypto'

/**
 * @file VerifyGasMeasurement
 * @description Isolated gas measurement for membership-proof verification.
 *
 * Calls `measureVerifyGas(element, witness)` on both PlasmaChainUTXO (ECC)
 * and PlasmaChainUTXOMerkle (Merkle). Returns receipt.gasUsed per invocation.
 *
 * Methodology:
 *   - N independent runs per mode (default 10)
 *   - Each run takes evm_snapshot, calls measureVerifyGas, reverts state
 *   - Random (element, witness) per run — verify gas is structurally independent
 *     of input validity for both primitives (constant scalarMul/hash chain)
 *   - Reports mean ± std, min, max, and raw samples
 *
 * Yields paper-defensible isolated verify cost for Section VI.C.3.
 */

export type AccumulatorMode = 'ecc' | 'merkle'

export interface VerifyGasResult {
  mode: AccumulatorMode
  contractAddress: Address
  proofLength: number       // for Merkle: proof.length; for ECC: 1 (point pair)
  meanGas: string           // bigint serialized
  stdGas: string            // float
  minGas: string
  maxGas: string
  runs: number
  samples: string[]
}

const l2Url = envConfig.L2_RPC_URL || 'http://localhost:8545'
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

async function measureGas(hash: Hex): Promise<bigint> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Tx reverted: ${hash}`)
  return receipt.gasUsed
}

async function takeSnapshot(): Promise<Hex> {
  return await publicClient.request({ method: 'evm_snapshot' as any, params: [] as any }) as Hex
}

async function revertSnapshot(id: Hex): Promise<void> {
  await publicClient.request({ method: 'evm_revert' as any, params: [id] as any })
}

function aggregate(samples: bigint[]) {
  const sum = samples.reduce((a, b) => a + b, 0n)
  const meanBig = sum / BigInt(samples.length)
  const meanNum = Number(meanBig)
  let variance = 0
  for (const s of samples) variance += Math.pow(Number(s) - meanNum, 2)
  variance /= samples.length
  let min = samples[0], max = samples[0]
  for (const s of samples) {
    if (s < min) min = s
    if (s > max) max = s
  }
  return {
    mean: meanBig.toString(),
    std: Math.sqrt(variance).toFixed(2),
    min: min.toString(),
    max: max.toString(),
  }
}

/** Generate a random non-trivial ECC Point for gas measurement (validity-agnostic). */
function randomEccWitness() {
  const x = '0x' + crypto.randomBytes(32).toString('hex') as Hex
  const y = '0x' + crypto.randomBytes(32).toString('hex') as Hex
  return { x: BigInt(x), y: BigInt(y) }
}

/** Generate a random Merkle proof of given length for gas measurement. */
function randomMerkleProof(length: number): Hex[] {
  const proof: Hex[] = []
  for (let i = 0; i < length; i++) {
    proof.push(('0x' + crypto.randomBytes(32).toString('hex')) as Hex)
  }
  return proof
}

export async function measureVerifyGas(
  mode: AccumulatorMode,
  options: { runs?: number; merkleProofLength?: number } = {}
): Promise<VerifyGasResult> {
  const runs = options.runs ?? 10
  const merkleProofLength = options.merkleProofLength ?? 20  // matches our on-chain depth
  const { addr, abi } = getContractInfo(mode)

  console.log(`[VerifyGas ${mode.toUpperCase()}] starting: runs=${runs}, proofLength=${mode === 'merkle' ? merkleProofLength : 1}`)

  const samples: bigint[] = []
  let actualProofLen = mode === 'merkle' ? merkleProofLength : 1

  for (let r = 0; r < runs; r++) {
    const snap = await takeSnapshot()
    try {
      const element = ('0x' + crypto.randomBytes(32).toString('hex')) as Hex

      let hash: Hex
      if (mode === 'merkle') {
        const proof = randomMerkleProof(merkleProofLength)
        hash = await operatorClient.writeContract({
          address: addr, abi,
          functionName: 'measureVerifyGas',
          args: [element, proof],
          gas: 30_000_000n,
        } as any)
      } else {
        const witness = randomEccWitness()
        hash = await operatorClient.writeContract({
          address: addr, abi,
          functionName: 'measureVerifyGas',
          args: [element, { x: witness.x, y: witness.y }],
          gas: 30_000_000n,
        } as any)
      }
      const gas = await measureGas(hash)
      samples.push(gas)
    } finally {
      try { await revertSnapshot(snap) } catch {}
    }
    console.log(`[VerifyGas ${mode}] run ${r + 1}/${runs}: ${samples[r]} gas`)
  }

  const agg = aggregate(samples)
  return {
    mode,
    contractAddress: addr,
    proofLength: actualProofLen,
    meanGas: agg.mean,
    stdGas: agg.std,
    minGas: agg.min,
    maxGas: agg.max,
    runs,
    samples: samples.map(s => s.toString()),
  }
}

export async function runFullVerifyGasMeasurement(
  options: { runs?: number; merkleProofLength?: number } = {}
): Promise<{ ecc: VerifyGasResult; merkle: VerifyGasResult }> {
  const opts = { runs: options.runs ?? 10, merkleProofLength: options.merkleProofLength ?? 20 }
  console.log(`[VerifyGas] runs=${opts.runs}, merkleProofLength=${opts.merkleProofLength}`)
  const ecc = await measureVerifyGas('ecc', opts)
  const merkle = await measureVerifyGas('merkle', opts)
  return { ecc, merkle }
}
