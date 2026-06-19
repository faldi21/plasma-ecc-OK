import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { envConfig } from '../config/env.js'
import { plasmaChainUtxoAbi as plasmaChainUtxoAbiEcc, plasmaChainUtxoMerkleAbi } from '../config/abis.js'
import crypto from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'

const UTXO_CREATED_TOPIC = '0x59dce56783317e2c8db67ecf2d03e2a49b44fb6972bbed9557631a9b96a27547'

export type AccumulatorMode = 'ecc' | 'merkle'

export interface TpsTestConfig {
  totalTransactions: number
  concurrency: number
  amountPerTx: string
  batchSize?: number          // sub-ops per tx; 1 = single transferUtxo, >1 = transferUtxoBatch
  createBlockEvery?: number   // call createBlock after every N successful sub-ops (0 = never, default)
  revertAfter?: boolean       // if true, evm_revert Anvil state after test (Anvil only) for clean benchmarks
  flushPendingChunkSize?: number  // if > 0, drain pendingUtxos via createBlockChunked at end (per-call ops)
  mode?: AccumulatorMode      // 'ecc' (default) or 'merkle' — selects which contract to benchmark
}

export interface TpsTestStatus {
  status: 'idle' | 'funding' | 'running' | 'complete' | 'error'
  completedTx: number
  failedTx: number
  totalTx: number
  elapsedMs: number
  currentTps: number
  avgLatency: number
  recentLatencies: number[]
  errors: string[]
  result: TpsTestResult | null
}

export interface TpsTestResult {
  id?: string
  label?: string
  config?: TpsTestConfig
  totalTransactions: number
  successfulTransactions: number
  failedTransactions: number
  tps: number
  avgLatency: number
  minLatency: number
  maxLatency: number
  durationMs: number
  timestamp: number
}

const HISTORY_FILE = resolve(process.cwd(), '..', 'data', 'tps-history.json')

function loadHistory(): TpsTestResult[] {
  try {
    if (!existsSync(HISTORY_FILE)) return []
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8')) as TpsTestResult[]
  } catch {
    return []
  }
}

function saveHistory(history: TpsTestResult[]): void {
  const dir = dirname(HISTORY_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
}

class TpsTestRunner {
  private _status: TpsTestStatus['status'] = 'idle'
  private _completedTx = 0
  private _failedTx = 0
  private _totalTx = 0
  private _startTime = 0
  private _latencies: number[] = []
  private _errors: string[] = []
  private _result: TpsTestResult | null = null
  private _abortFlag = false
  private _activeSnapshotId: Hex | null = null
  private _activeL2Url: string | null = null

  getStatus(): TpsTestStatus {
    const elapsedMs = this._status === 'running'
      ? Date.now() - this._startTime
      : (this._result?.durationMs ?? 0)
    const currentTps = elapsedMs > 0 ? this._completedTx / (elapsedMs / 1000) : 0
    const avgLatency = this._latencies.length > 0
      ? this._latencies.reduce((a, b) => a + b, 0) / this._latencies.length
      : 0

    return {
      status: this._status,
      completedTx: this._completedTx,
      failedTx: this._failedTx,
      totalTx: this._totalTx,
      elapsedMs,
      currentTps,
      avgLatency,
      recentLatencies: this._latencies.slice(-30),
      errors: this._errors.slice(-20),
      result: this._result,
    }
  }

  stop() {
    this._abortFlag = true
  }

  getHistory(): TpsTestResult[] {
    return loadHistory()
  }

  setLabel(id: string, label: string): boolean {
    const history = loadHistory()
    const idx = history.findIndex(r => r.id === id)
    if (idx === -1) return false
    history[idx].label = label
    saveHistory(history)
    return true
  }

  deleteResult(id: string): boolean {
    const history = loadHistory()
    const filtered = history.filter(r => r.id !== id)
    if (filtered.length === history.length) return false
    saveHistory(filtered)
    return true
  }

  clearHistory(): void {
    saveHistory([])
  }

  async start(config: TpsTestConfig): Promise<void> {
    if (this._status === 'running' || this._status === 'funding') {
      throw new Error('Test already running')
    }
    this._status = 'idle'
    this._completedTx = 0
    this._failedTx = 0
    this._totalTx = config.totalTransactions
    this._startTime = 0
    this._latencies = []
    this._errors = []
    this._result = null
    this._abortFlag = false

    this._run(config).catch(async (err) => {
      this._status = 'error'
      this._errors.push(err.message)
      // Error-path snapshot cleanup — ensure Anvil state doesn't leak across runs
      if (this._activeSnapshotId && this._activeL2Url) {
        try {
          const cleanupClient = createPublicClient({
            chain: { id: 31337, name: 'L2', nativeCurrency: { decimals: 18, name: 'ETH', symbol: 'ETH' }, rpcUrls: { default: { http: [this._activeL2Url] }, public: { http: [this._activeL2Url] } } } as const,
            transport: http(this._activeL2Url),
          })
          await cleanupClient.request({ method: 'evm_revert' as any, params: [this._activeSnapshotId] as any })
          console.log(`[TpsTest] error-path revert to ${this._activeSnapshotId} done`)
        } catch (e: any) {
          console.warn('[TpsTest] error-path revert failed:', e?.message || e)
        } finally {
          this._activeSnapshotId = null
        }
      }
    })
  }

  private async _run(config: TpsTestConfig): Promise<void> {
    const amountPerTx = parseEther(config.amountPerTx)
    const l2Url = envConfig.L2_RPC_URL || 'http://localhost:8545'
    const mode: AccumulatorMode = config.mode || 'ecc'
    const plasmaChainAddr = (
      mode === 'merkle'
        ? envConfig.PLASMA_CHAIN_UTXO_MERKLE_ADDRESS
        : envConfig.PLASMA_CHAIN_UTXO_ADDRESS
    ) as Address
    if (!plasmaChainAddr) {
      throw new Error(`Contract address not configured for mode '${mode}'. Check .env for ${
        mode === 'merkle' ? 'PLASMA_CHAIN_UTXO_MERKLE_ADDRESS' : 'PLASMA_CHAIN_UTXO_ADDRESS'
      }`)
    }
    const plasmaChainUtxoAbi = mode === 'merkle' ? plasmaChainUtxoMerkleAbi : plasmaChainUtxoAbiEcc
    const tokenAddr = envConfig.L2_PLASMA_TOKEN_ADDRESS as Address
    console.log(`[TpsTest] Mode: ${mode.toUpperCase()}, contract: ${plasmaChainAddr}`)

    const l2Chain = {
      id: 31337,
      name: 'Plasma L2',
      nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
      rpcUrls: { default: { http: [l2Url] }, public: { http: [l2Url] } },
    } as const

    // HTTP transport timeout 60s — heavy batch tx (createDepositUtxoBatch with 100 deposits,
    // transferUtxoBatch with 50-100 sub-ops) can take >10s on Anvil; default 10s causes spurious
    // "The request took too long to respond" failures under sustained load.
    const httpTransport = http(l2Url, { timeout: 60_000 })
    const publicClient = createPublicClient({ chain: l2Chain, transport: httpTransport, pollingInterval: 100 })
    this._activeL2Url = l2Url

    // Snapshot Anvil state before test if revertAfter is enabled
    let snapshotId: Hex | null = null
    if (config.revertAfter) {
      try {
        snapshotId = await publicClient.request({ method: 'evm_snapshot' as any, params: [] as any }) as Hex
        this._activeSnapshotId = snapshotId  // track for error-path cleanup
        console.log(`[TpsTest] evm_snapshot taken: ${snapshotId}`)
      } catch (err) {
        console.warn('[TpsTest] evm_snapshot not supported, skipping:', err)
      }
    }

    const testPks = [
      process.env.PK_USER_A,
      process.env.PK_USER_B,
      process.env.PK_USER_C,
    ].filter((pk): pk is string => !!pk)

    if (testPks.length < 2) throw new Error('Need at least PK_USER_A and PK_USER_B in .env')

    const concurrency = Math.min(config.concurrency, testPks.length)
    const testAccounts = testPks.map(pk => {
      const account = privateKeyToAccount(pk as Hex)
      const client = createWalletClient({ account, chain: l2Chain, transport: http(l2Url) })
      return { account, client }
    })

    const operatorAccount = privateKeyToAccount(envConfig.L2_OPERATOR_PRIVATE_KEY)
    const operatorClient = createWalletClient({ account: operatorAccount, chain: l2Chain, transport: http(l2Url) })

    const batchSize = Math.max(1, config.batchSize || 1)
    const useBatch = batchSize > 1

    // Fund all test accounts
    this._status = 'funding'
    const utxoMap = new Map<string, Hex[]>()

    if (useBatch) {
      // Pre-split: each account gets N small UTXOs (one per planned sub-op)
      const subOpsPerAccount = Math.ceil(config.totalTransactions / concurrency)
      const DEPOSIT_CHUNK = 400 // bounded by 50M gas

      for (const { account } of testAccounts) {
        const allDepositIds: Hex[] = []
        for (let off = 0; off < subOpsPerAccount; off += DEPOSIT_CHUNK) {
          const chunkCount = Math.min(DEPOSIT_CHUNK, subOpsPerAccount - off)
          const chunkIds: Hex[] = []
          const chunkUsers: Address[] = []
          const chunkAmts: bigint[] = []
          for (let i = 0; i < chunkCount; i++) {
            chunkIds.push(('0x' + crypto.randomBytes(32).toString('hex')) as Hex)
            chunkUsers.push(account.address)
            chunkAmts.push(amountPerTx)
          }
          const hash = await operatorClient.writeContract({
            address: plasmaChainAddr,
            abi: plasmaChainUtxoAbi,
            functionName: 'createDepositUtxoBatch',
            args: [chunkIds, chunkUsers, tokenAddr, chunkAmts],
            gas: 80_000_000n,
          } as any)
          await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 })
          allDepositIds.push(...chunkIds)
        }
        utxoMap.set(account.address.toLowerCase(), allDepositIds)
      }
    } else {
      // Single-tx mode: fund each account with 1 large UTXO
      const roundsPerAccount = Math.ceil(config.totalTransactions / concurrency) + 5
      const fundAmount = amountPerTx * BigInt(roundsPerAccount)
      for (const { account } of testAccounts) {
        const fakeDepositId = ('0x' + crypto.randomBytes(32).toString('hex')) as Hex
        const hash = await operatorClient.writeContract({
          address: plasmaChainAddr,
          abi: plasmaChainUtxoAbi,
          functionName: 'createDepositUtxo',
          args: [fakeDepositId, account.address, tokenAddr, fundAmount],
          gas: 50_000_000n,
        } as any)
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 })
        utxoMap.set(account.address.toLowerCase(), this._extractUtxos(receipt.logs, account.address))
      }
    }

    // Run transfers
    this._status = 'running'
    this._startTime = Date.now()

    let completed = 0
    let roundIdx = 0
    while (completed < config.totalTransactions && !this._abortFlag) {
      const remaining = config.totalTransactions - completed

      // Plan this parallel round: distribute remaining work BALANCED across all senders
      // (avoid funneling all ops to a single sender, which would exceed their UTXO allotment)
      const slots: Array<{ senderIdx: number; receiverIdx: number; opCount: number }> = []
      const balancedPerSlot = Math.min(batchSize, Math.ceil(remaining / concurrency))
      let plannedThisRound = 0
      for (let i = 0; i < concurrency; i++) {
        if (plannedThisRound >= remaining) break
        const senderIdx = (roundIdx + i) % testAccounts.length
        const receiverIdx = (senderIdx + 1) % testAccounts.length
        const opCount = Math.min(balancedPerSlot, remaining - plannedThisRound)
        if (opCount <= 0) break
        slots.push({ senderIdx, receiverIdx, opCount })
        plannedThisRound += opCount
      }
      if (slots.length === 0) break

      const roundStart = Date.now()
      const results = await Promise.allSettled(
        slots.map(({ senderIdx, receiverIdx, opCount }) =>
          useBatch
            ? this._batchTransfer(publicClient, testAccounts[senderIdx], testAccounts[receiverIdx].account.address, utxoMap, plasmaChainAddr, amountPerTx, opCount, plasmaChainUtxoAbi)
            : this._transfer(publicClient, testAccounts[senderIdx], testAccounts[receiverIdx].account.address, utxoMap, plasmaChainAddr, amountPerTx, plasmaChainUtxoAbi).then(r => ({ ...r, opCount: 1 }))
        )
      )

      for (let i = 0; i < results.length; i++) {
        const slot = slots[i]
        const senderAddr = testAccounts[slot.senderIdx].account.address.toLowerCase()
        const receiverAddr = testAccounts[slot.receiverIdx].account.address.toLowerCase()

        if (results[i].status === 'fulfilled') {
          this._latencies.push(Date.now() - roundStart)
          this._completedTx += slot.opCount
          if (!useBatch) {
            const { senderNewUtxos, receiverNewUtxos } = (results[i] as PromiseFulfilledResult<any>).value
            utxoMap.set(senderAddr, [...(utxoMap.get(senderAddr) || []).slice(1), ...senderNewUtxos])
            utxoMap.set(receiverAddr, [...(utxoMap.get(receiverAddr) || []), ...receiverNewUtxos])
          }
          // batch mode updates map inside _batchTransfer
        } else {
          this._failedTx += slot.opCount
          const reason = (results[i] as PromiseRejectedResult).reason
          const senderShort = senderAddr.slice(0, 10)
          const receiverShort = receiverAddr.slice(0, 10)
          const shortMsg = (reason?.shortMessage || reason?.message || 'unknown').slice(0, 200)
          this._errors.push(`Round ${roundIdx} slot ${i} (${senderShort}→${receiverShort}, ${slot.opCount} ops): ${shortMsg}`)
          console.error(`[TpsTest] FAILED round=${roundIdx} ${senderShort}→${receiverShort}:`, reason?.message || reason)
        }
      }

      completed = this._completedTx + this._failedTx
      roundIdx++

      // Periodic block commit
      if (config.createBlockEvery && config.createBlockEvery > 0 && this._completedTx > 0) {
        const lastCommitAt = Math.floor((this._completedTx - slots.reduce((s, t) => s + t.opCount, 0)) / config.createBlockEvery)
        const nowCommitAt = Math.floor(this._completedTx / config.createBlockEvery)
        if (nowCommitAt > lastCommitAt) {
          try {
            const blockHash = await operatorClient.writeContract({
              address: plasmaChainAddr,
              abi: plasmaChainUtxoAbi,
              functionName: 'createBlock',
              gas: 250_000_000n,
            } as any)
            await publicClient.waitForTransactionReceipt({ hash: blockHash, timeout: 120_000 })
          } catch (err: any) {
            console.error('[TpsTest] createBlock failed:', err?.message || err)
          }
        }
      }
    }

    const duration = Date.now() - this._startTime
    const avgL = this._latencies.length > 0
      ? this._latencies.reduce((a, b) => a + b, 0) / this._latencies.length
      : 0

    // Optional: drain pendingUtxos via createBlockChunked (separate from TPS measurement)
    if (config.flushPendingChunkSize && config.flushPendingChunkSize > 0) {
      console.log(`[TpsTest] Flushing pendingUtxos with chunk size ${config.flushPendingChunkSize}...`)
      let chunks = 0
      while (chunks < 100) {  // safety cap
        try {
          const flushHash = await operatorClient.writeContract({
            address: plasmaChainAddr,
            abi: plasmaChainUtxoAbi,
            functionName: 'createBlockChunked',
            args: [BigInt(config.flushPendingChunkSize)],
            gas: 280_000_000n,
          } as any)
          const receipt = await publicClient.waitForTransactionReceipt({ hash: flushHash, timeout: 120_000 })
          if (receipt.status !== 'success') {
            console.warn('[TpsTest] createBlockChunked reverted, stopping flush')
            break
          }
          chunks++
          // Check if pending is drained
          const pendingLen = await publicClient.readContract({
            address: plasmaChainAddr,
            abi: plasmaChainUtxoAbi,
            functionName: 'getPendingUtxoCount',
          } as any) as bigint
          if (pendingLen === 0n) break
        } catch (err: any) {
          const msg = err?.shortMessage || err?.message || 'unknown'
          if (msg.includes('Nothing to process')) break
          console.error('[TpsTest] flush error:', msg)
          break
        }
      }
      console.log(`[TpsTest] Flush done in ${chunks} chunks`)
    }

    // Optional: revert Anvil state to clean snapshot (clears all UTXO state added during test)
    if (snapshotId) {
      try {
        await publicClient.request({ method: 'evm_revert' as any, params: [snapshotId] as any })
        console.log(`[TpsTest] evm_revert to ${snapshotId} done`)
        this._activeSnapshotId = null  // success cleanup done
      } catch (err: any) {
        console.warn('[TpsTest] evm_revert failed:', err?.message || err)
      }
    }

    this._status = 'complete'
    const safeDuration = duration > 0 ? duration : 1
    this._result = {
      id: crypto.randomBytes(8).toString('hex'),
      config,
      totalTransactions: this._completedTx + this._failedTx,
      successfulTransactions: this._completedTx,
      failedTransactions: this._failedTx,
      tps: this._completedTx > 0 ? this._completedTx / (safeDuration / 1000) : 0,
      avgLatency: avgL || 0,
      minLatency: this._latencies.length > 0 ? Math.min(...this._latencies) : 0,
      maxLatency: this._latencies.length > 0 ? Math.max(...this._latencies) : 0,
      durationMs: duration,
      timestamp: Date.now(),
    }

    // Persist to history
    try {
      const history = loadHistory()
      history.unshift(this._result)
      saveHistory(history.slice(0, 100)) // keep last 100
    } catch (err) {
      console.error('[TpsTest] Failed to save history:', err)
    }
  }

  private async _transfer(
    publicClient: any,
    sender: { account: { address: Address }; client: any },
    receiverAddr: Address,
    utxoMap: Map<string, Hex[]>,
    plasmaChainAddr: Address,
    amountPerTx: bigint,
    plasmaChainUtxoAbi: any,
  ) {
    const senderKey = sender.account.address.toLowerCase()
    const utxos = utxoMap.get(senderKey) || []
    if (utxos.length === 0) throw new Error(`No UTXOs for ${senderKey}`)

    const inputUtxoId = utxos[0]
    const utxoData = await publicClient.readContract({
      address: plasmaChainAddr,
      abi: plasmaChainUtxoAbi,
      functionName: 'utxos',
      args: [inputUtxoId],
    } as any) as any[]

    const utxoAmount = BigInt(utxoData[3])
    if (utxoAmount < amountPerTx) throw new Error(`Insufficient UTXO: ${utxoAmount} < ${amountPerTx}`)

    const change = utxoAmount - amountPerTx
    const outputOwners: Address[] = [receiverAddr]
    const outputAmounts: bigint[] = [amountPerTx]
    if (change > 0n) {
      outputOwners.push(sender.account.address)
      outputAmounts.push(change)
    }

    const callData = encodeFunctionData({
      abi: plasmaChainUtxoAbi,
      functionName: 'transferUtxo',
      args: [[inputUtxoId], outputOwners, outputAmounts, '0x'],
    })

    const hash = await sender.client.writeContract({
      address: plasmaChainAddr,
      abi: plasmaChainUtxoAbi,
      functionName: 'transferUtxo',
      args: [[inputUtxoId], outputOwners, outputAmounts, '0x'],
      gas: 50_000_000n,
    } as any)

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 })
    if (receipt.status !== 'success') {
      // Re-simulate at pre-block state to recover the revert reason
      let revertReason = 'reverted (no reason)'
      try {
        await publicClient.call({
          account: sender.account.address,
          to: plasmaChainAddr,
          data: callData,
          blockNumber: receipt.blockNumber - 1n,
        })
        revertReason = 'reverted on submit, but simulation at pre-block passed (race condition)'
      } catch (err: any) {
        revertReason = err?.shortMessage || err?.message?.split('\n')[0] || 'call failed'
      }
      console.error(`[TpsTest] REVERT for ${sender.account.address}→${receiverAddr} utxo=${inputUtxoId} amount=${utxoAmount}:`)
      console.error(`  reason: ${revertReason}`)
      throw new Error(`Reverted: ${revertReason}`)
    }

    return {
      senderNewUtxos: this._extractUtxos(receipt.logs, sender.account.address),
      receiverNewUtxos: this._extractUtxos(receipt.logs, receiverAddr),
    }
  }

  private async _batchTransfer(
    publicClient: any,
    sender: { account: { address: Address }; client: any },
    receiverAddr: Address,
    utxoMap: Map<string, Hex[]>,
    plasmaChainAddr: Address,
    amountPerTx: bigint,
    opCount: number,
    plasmaChainUtxoAbi: any,
  ): Promise<{ opCount: number }> {
    const senderKey = sender.account.address.toLowerCase()
    const utxos = utxoMap.get(senderKey) || []
    if (utxos.length < opCount) throw new Error(`Insufficient UTXOs for batch: ${utxos.length} < ${opCount}`)

    const inputs = utxos.slice(0, opCount)
    const outputOwners: Address[] = []
    const outputAmounts: bigint[] = []
    const outputCounts: number[] = []
    for (let i = 0; i < opCount; i++) {
      outputOwners.push(receiverAddr)
      outputAmounts.push(amountPerTx)
      outputCounts.push(1)
    }

    const callArgs = [inputs, outputOwners, outputAmounts, outputCounts]
    const hash = await sender.client.writeContract({
      address: plasmaChainAddr,
      abi: plasmaChainUtxoAbi,
      functionName: 'transferUtxoBatch',
      args: callArgs,
      gas: 150_000_000n,
    } as any)

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 })
    if (receipt.status !== 'success') {
      let reason = 'reverted (no reason)'
      try {
        await publicClient.call({
          account: sender.account.address,
          to: plasmaChainAddr,
          data: encodeFunctionData({
            abi: plasmaChainUtxoAbi,
            functionName: 'transferUtxoBatch',
            args: callArgs,
          }),
          blockNumber: receipt.blockNumber - 1n,
        })
        reason = 'race condition'
      } catch (err: any) {
        reason = err?.shortMessage || err?.message?.split('\n')[0] || 'unknown'
      }
      throw new Error(`Batch reverted: ${reason}`)
    }

    // Update map: spent inputs gone, new outputs go to receiver
    utxoMap.set(senderKey, utxos.slice(opCount))
    const receiverKey = receiverAddr.toLowerCase()
    const newReceiverUtxos = this._extractUtxos(receipt.logs, receiverAddr)
    utxoMap.set(receiverKey, [...(utxoMap.get(receiverKey) || []), ...newReceiverUtxos])

    return { opCount }
  }

  private _extractUtxos(logs: readonly any[], owner: Address): Hex[] {
    const ownerNorm = owner.toLowerCase()
    return logs
      .filter(log => log.topics[0] === UTXO_CREATED_TOPIC)
      .filter(log => ('0x' + (log.topics[2] as string).slice(-40)).toLowerCase() === ownerNorm)
      .map(log => log.topics[1] as Hex)
  }
}

export const tpsRunner = new TpsTestRunner()
