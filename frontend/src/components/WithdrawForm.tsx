import { useState, useEffect, useCallback } from 'react'
import { useAccount, usePublicClient, useChainId, useSwitchChain, useWalletClient } from 'wagmi'
import { createPublicClient, http, parseEther, formatEther, type Address, type Hex, keccak256, encodePacked, parseEventLogs } from 'viem'
import { sepolia } from 'wagmi/chains'
import { cn } from '../utils'
import { getContractConfig, getBackendApiUrl, type ContractConfig } from '../utils/config'
import PlasmaChainUTXOABI from '../abis/PlasmaChainUTXO.json'
import RootChainUTXOABI from '../abis/RootChainUTXO.json'
import { ArrowUpCircle, Loader2, CheckCircle, AlertCircle, Wallet, Network, Clock, Coins, ExternalLink } from 'lucide-react'
import { plasmaL2 } from '../config'

interface UTXO {
  utxoId: Hex
  owner: string
  token: string
  amount: bigint
  spent: boolean
  blockNumber: number
}

interface WithdrawalHistoryItem {
  exitId: Hex
  amount: string
  l1TxHash?: string
  createdAt: number
}

interface ExitStatus {
  exitTime: number
  processed: boolean
  challenged: boolean
  amount: bigint
}

const HISTORY_STORAGE_KEY = 'plasma-utxo-withdraw-history'
const AUTO_FINALIZE_KEY = 'plasma-utxo-auto-finalize'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const EXIT_ID_MIGRATIONS: Record<string, Hex> = {
  '0x6868d6e80efc4190562f7a5cfd4c5fc307809e9328968f117436e038c7e40971':
    '0x1d8848b09c76a5bb141ac5cad352739dd65f0aab9e7e0e2409d7da02f619f4ea',
}

const applyExitIdMigrations = (items: WithdrawalHistoryItem[]) => {
  const seen = new Set<string>()
  const updated: WithdrawalHistoryItem[] = []

  for (const item of items) {
    const normalized = item.exitId.toLowerCase()
    const migrated = EXIT_ID_MIGRATIONS[normalized] ?? item.exitId
    const migratedKey = migrated.toLowerCase()
    if (seen.has(migratedKey)) continue
    seen.add(migratedKey)
    updated.push({
      ...item,
      exitId: migrated,
    })
  }

  return updated
}

// Create standalone L2 client that works regardless of current network
const l2PublicClient = createPublicClient({
  chain: plasmaL2,
  transport: http('http://localhost:8545'),
})

export function WithdrawForm() {
  const { address: connectedAddress, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const l1Client = usePublicClient({ chainId: sepolia.id })
  const { data: walletClient } = useWalletClient()

  const [amount, setAmount] = useState('')
  const [contractConfig, setContractConfig] = useState<ContractConfig | null>(null)

  const [userUtxos, setUserUtxos] = useState<UTXO[]>([])
  const [totalBalance, setTotalBalance] = useState(0n)
  const [isLoadingUtxos, setIsLoadingUtxos] = useState(false)

  const [isProcessing, setIsProcessing] = useState(false)
  const [currentStep, setCurrentStep] = useState<
    | 'idle'
    | 'sign'
    | 'aggregate'
    | 'create_block'
    | 'accumulator'
    | 'submit_block'
    | 'register_exit'
    | 'get_witness'
    | 'l1_exit'
    | 'success'
    | 'error'
  >('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successResult, setSuccessResult] = useState<{
    l2TxHash?: string
    l1TxHash?: string
    exitId?: string
    amount: string
  } | null>(null)
  const [finalizeExitId, setFinalizeExitId] = useState('')
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [finalizeHash, setFinalizeHash] = useState<string | null>(null)
  const [autoFinalizeEnabled, setAutoFinalizeEnabled] = useState(true)
  const [autoFinalizeAttempted, setAutoFinalizeAttempted] = useState<Record<string, boolean>>({})
  const [withdrawHistory, setWithdrawHistory] = useState<WithdrawalHistoryItem[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [exitStatuses, setExitStatuses] = useState<Record<string, ExitStatus>>({})

  // Load contract config on mount
  useEffect(() => {
    getContractConfig().then(setContractConfig)
  }, [])

  // Load auto-finalize preference
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem(AUTO_FINALIZE_KEY)
    if (saved !== null) {
      setAutoFinalizeEnabled(saved === 'true')
    }
  }, [])

  // Persist auto-finalize preference
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(AUTO_FINALIZE_KEY, String(autoFinalizeEnabled))
  }, [autoFinalizeEnabled])

  // Load withdraw history from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as WithdrawalHistoryItem[]
        const migrated = applyExitIdMigrations(parsed)
        setWithdrawHistory(migrated)
      } else {
        setWithdrawHistory([])
      }
    } catch (error) {
      console.warn('Failed to load withdraw history:', error)
      setWithdrawHistory([])
    } finally {
      setHistoryLoaded(true)
    }
  }, [])

  // Persist withdraw history to localStorage
  useEffect(() => {
    if (typeof window === 'undefined' || !historyLoaded) return
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(withdrawHistory))
    } catch (error) {
      console.warn('Failed to save withdraw history:', error)
    }
  }, [withdrawHistory, historyLoaded])

  // Refresh exit status for history entries
  useEffect(() => {
    if (!l1Client || withdrawHistory.length === 0) return

    let cancelled = false

    const fetchStatuses = async () => {
      const updates: Record<string, ExitStatus> = {}

      await Promise.all(withdrawHistory.map(async (item) => {
        try {
          const exitData = await l1Client.readContract({
            address: contractConfig?.ROOT_CHAIN_UTXO_ADDRESS as Address,
            abi: RootChainUTXOABI.abi,
            functionName: 'exits',
            args: [item.exitId],
          }) as [Address, Hex, Address, bigint, bigint, bigint, boolean, boolean]

          const [owner, , , amount, , exitTime, processed, challenged] = exitData
          if (owner.toLowerCase() === ZERO_ADDRESS) return

          updates[item.exitId] = {
            exitTime: Number(exitTime),
            processed,
            challenged,
            amount,
          }
        } catch (error) {
          console.warn(`Failed to fetch exit ${item.exitId}:`, error)
        }
      }))

      if (!cancelled && Object.keys(updates).length > 0) {
        setExitStatuses((prev) => ({ ...prev, ...updates }))
      }
    }

    fetchStatuses()
    const interval = setInterval(fetchStatuses, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [withdrawHistory, l1Client, contractConfig])

  // Fetch user's UTXOs from L2 (works regardless of current network)
  useEffect(() => {
    if (!connectedAddress || !contractConfig) return

    const fetchUtxos = async () => {
      setIsLoadingUtxos(true)
      try {
        const utxoIds = await l2PublicClient.readContract({
          address: contractConfig.PLASMA_CHAIN_UTXO_ADDRESS as Address,
          abi: PlasmaChainUTXOABI.abi,
          functionName: 'getUserUtxos',
          args: [connectedAddress],
        }) as Hex[]

        const utxos: UTXO[] = []
        let total = 0n

        for (const utxoId of utxoIds) {
          try {
            const utxoData = await l2PublicClient.readContract({
              address: contractConfig.PLASMA_CHAIN_UTXO_ADDRESS as Address,
              abi: PlasmaChainUTXOABI.abi,
              functionName: 'utxos',
              args: [utxoId],
            }) as [Hex, Address, Address, bigint, bigint, boolean, Hex]

            const [, owner, token, utxoAmount, blockNumber, spent] = utxoData

            if (!spent) {
              total += utxoAmount
              utxos.push({
                utxoId,
                owner,
                token,
                amount: utxoAmount,
                spent,
                blockNumber: Number(blockNumber),
              })
            }
          } catch (e) {
            console.warn(`Failed to fetch UTXO ${utxoId}:`, e)
          }
        }

        setUserUtxos(utxos)
        setTotalBalance(total)
      } catch (e) {
        console.error('Failed to fetch UTXOs:', e)
      } finally {
        setIsLoadingUtxos(false)
      }
    }

    fetchUtxos()
    const interval = setInterval(fetchUtxos, 5000)
    return () => clearInterval(interval)
  }, [connectedAddress, contractConfig])

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!connectedAddress || !amount || !contractConfig || !walletClient) return

    setIsProcessing(true)
    setCurrentStep('sign')
    setErrorMessage(null)
    setSuccessResult(null)

    try {
      const parsedAmount = parseEther(amount)
      const token = contractConfig.L2_PLASMA_TOKEN_ADDRESS as Address

      if (totalBalance === 0n) {
        throw new Error('No L2 balance to withdraw')
      }
      if (parsedAmount > totalBalance) {
        throw new Error(`Insufficient balance. Max: ${formatEther(totalBalance)} PLASMA`)
      }

      // 1. Sign aggregation request
      setCurrentStep('sign')
      const nonce = await l2PublicClient.readContract({
        address: contractConfig.PLASMA_CHAIN_UTXO_ADDRESS as Address,
        abi: PlasmaChainUTXOABI.abi,
        functionName: 'nonces',
        args: [connectedAddress],
      }) as bigint

      const messageHash = keccak256(
        encodePacked(
          ['address', 'address', 'uint256', 'string', 'uint256'],
          [connectedAddress, token, parsedAmount, 'AGGREGATE_WITHDRAW', nonce]
        )
      )

      const signature = await walletClient.signMessage({
        message: { raw: messageHash },
      })

      // 2. Aggregate UTXOs on L2 (operator via backend)
      setCurrentStep('aggregate')
      const aggregateResponse = await fetch(`${getBackendApiUrl()}/api/withdraw/aggregate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: connectedAddress,
          tokenAddress: token,
          amount: parsedAmount.toString(),
          signature,
        }),
      })
      const aggregateData = await aggregateResponse.json()
      if (!aggregateData.success || !aggregateData.data?.exitUtxoId) {
        throw new Error(aggregateData.error || 'Failed to aggregate withdrawal on L2')
      }

      const exitUtxoId = aggregateData.data.exitUtxoId as Hex

      // 3. Create L2 block (operator via backend)
      setCurrentStep('create_block')
      const createBlockResponse = await fetch(`${getBackendApiUrl()}/api/withdraw/create-block`, {
        method: 'POST',
      })
      const createBlockData = await createBlockResponse.json()
      if (!createBlockData.success) {
        throw new Error(createBlockData.error || 'Failed to create L2 block')
      }

      // 4. Add Exit UTXO to accumulator
      setCurrentStep('accumulator')
      const addResponse = await fetch(`${getBackendApiUrl()}/api/accumulator/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: exitUtxoId }),
      })
      const addData = await addResponse.json()
      if (!addData.success) {
        throw new Error(addData.error || 'Failed to add Exit UTXO to accumulator')
      }

      // 5. Submit block to L1
      setCurrentStep('submit_block')
      const submitResponse = await fetch(`${getBackendApiUrl()}/api/submit-block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionCount: 1 }),
      })
      const submitData = await submitResponse.json()
      if (!submitData.success || !submitData.data?.blockNumber) {
        throw new Error(submitData.error || 'Failed to submit block to L1')
      }

      const l1BlockNumber = BigInt(submitData.data.blockNumber)

      // 6. Register Exit UTXO on L1 (operator via backend)
      setCurrentStep('register_exit')
      const registerResponse = await fetch(`${getBackendApiUrl()}/api/withdraw/register-exit-utxo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exitUtxoId,
          userAddress: connectedAddress,
          tokenAddress: contractConfig.PLASMA_TOKEN_ADDRESS,
          amount: parsedAmount.toString(),
          blockNumber: l1BlockNumber.toString(),
        }),
      })
      const registerData = await registerResponse.json()
      if (!registerData.success) {
        throw new Error(registerData.error || 'Failed to register Exit UTXO on L1')
      }

      // 7. Get witness for Exit UTXO
      setCurrentStep('get_witness')
      const witnessResponse = await fetch(`${getBackendApiUrl()}/api/witness/${exitUtxoId}`)
      const witnessData = await witnessResponse.json()
      if (!witnessData.success || !witnessData.witness) {
        throw new Error(witnessData.error || 'Failed to get witness from backend')
      }

      const witness = {
        x: BigInt(witnessData.witness.x),
        y: BigInt(witnessData.witness.y),
      }
      const witnessBlockNumber = BigInt(witnessData.blockNumber || l1BlockNumber)

      // 8. Switch to L1 and start exit
      setCurrentStep('l1_exit')
      await switchChain({ chainId: sepolia.id })
      await new Promise(resolve => setTimeout(resolve, 2000))

      const l1TxHash = await walletClient.writeContract({
        address: contractConfig.ROOT_CHAIN_UTXO_ADDRESS as Address,
        abi: RootChainUTXOABI.abi,
        functionName: 'startExit',
        args: [exitUtxoId, witnessBlockNumber, witness],
        chain: sepolia,
        gas: 5_000_000n,
      })

      let exitId: Hex | null = null
      if (l1Client) {
        const receipt = await l1Client.waitForTransactionReceipt({ hash: l1TxHash })
        const exitLogs = parseEventLogs({
          abi: RootChainUTXOABI.abi,
          logs: receipt.logs,
          eventName: 'ExitStarted',
        })
        const matchingLog = exitLogs.find((log) => {
          const utxoId = (log.args as { utxoId?: Hex }).utxoId
          return !utxoId || utxoId.toLowerCase() === exitUtxoId.toLowerCase()
        })
        exitId = (matchingLog?.args as { exitId?: Hex })?.exitId ?? null
      }

      if (!exitId) {
        throw new Error('ExitStarted event not found. Please check Etherscan for Exit ID.')
      }

      setSuccessResult({
        l1TxHash,
        amount: formatEther(parsedAmount),
        exitId,
      })
      setWithdrawHistory((prev) => {
        if (prev.some((item) => item.exitId === exitId)) {
          return prev
        }
        const next = [
          {
            exitId,
            amount: formatEther(parsedAmount),
            l1TxHash,
            createdAt: Date.now(),
          },
          ...prev,
        ]
        return next.slice(0, 20)
      })
      setFinalizeExitId(exitId)
      setCurrentStep('success')
      setAmount('')
    } catch (err: any) {
      console.error('Withdrawal failed:', err)
      setErrorMessage(err.message || 'Withdrawal failed')
      setCurrentStep('error')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleFinalizeExit = useCallback(async (exitIdOverride?: string) => {
    if (!walletClient || !contractConfig) return

    const candidate = typeof exitIdOverride === 'string' ? exitIdOverride : finalizeExitId
    const trimmedExitId = candidate.trim()
    if (!trimmedExitId.startsWith('0x') || trimmedExitId.length !== 66) {
      setFinalizeError('Exit ID must be a 32-byte hex string (0x...)')
      return
    }

    setIsFinalizing(true)
    setFinalizeError(null)
    setFinalizeHash(null)

    try {
      if (chainId !== sepolia.id) {
        await switchChain({ chainId: sepolia.id })
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      const hash = await walletClient.writeContract({
        address: contractConfig.ROOT_CHAIN_UTXO_ADDRESS as Address,
        abi: RootChainUTXOABI.abi,
        functionName: 'finalizeExit',
        args: [trimmedExitId as Hex],
        chain: sepolia,
        gas: 5_000_000n,
      })

      if (l1Client) {
        await l1Client.waitForTransactionReceipt({ hash })
      }

      setFinalizeHash(hash)
    } catch (err: any) {
      console.error('Finalize exit failed:', err)
      setFinalizeError(err.message || 'Finalize exit failed')
    } finally {
      setIsFinalizing(false)
    }
  }, [walletClient, contractConfig, finalizeExitId, chainId, switchChain, l1Client])

  const now = Math.floor(Date.now() / 1000)

  useEffect(() => {
    if (!autoFinalizeEnabled || isFinalizing || !walletClient || !contractConfig) return

    const readyItem = withdrawHistory.find((item) => {
      const status = exitStatuses[item.exitId]
      if (!status || status.processed || status.challenged) return false
      return now >= status.exitTime
    })

    if (!readyItem) return
    if (autoFinalizeAttempted[readyItem.exitId]) return

    setAutoFinalizeAttempted((prev) => ({ ...prev, [readyItem.exitId]: true }))
    handleFinalizeExit(readyItem.exitId)
  }, [
    autoFinalizeEnabled,
    isFinalizing,
    walletClient,
    contractConfig,
    withdrawHistory,
    exitStatuses,
    now,
    autoFinalizeAttempted,
    handleFinalizeExit,
  ])

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center space-y-4 bg-white/5 rounded-xl border border-white/10">
        <Wallet className="w-12 h-12 text-gray-500" />
        <h3 className="text-xl font-semibold">Wallet Not Connected</h3>
        <p className="text-gray-400">Please connect your wallet to withdraw.</p>
      </div>
    )
  }

  if (!contractConfig) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center space-y-4 bg-white/5 rounded-xl border border-white/10">
        <Loader2 className="w-12 h-12 text-gray-500 animate-spin" />
        <h3 className="text-xl font-semibold">Loading Configuration</h3>
        <p className="text-gray-400">Fetching contract addresses from backend...</p>
      </div>
    )
  }

  const isOnL2 = chainId === 31337
  const isOnL1 = chainId === sepolia.id

  // Calculate if amount exceeds balance
  const amountBigInt = amount ? parseEther(amount) : 0n
  const isInsufficientBalance = amountBigInt > totalBalance && amount !== ''
  const maxBalance = formatEther(totalBalance)

  const formatTimeRemaining = (exitTime?: number) => {
    if (!exitTime) return 'Unknown'
    const remaining = exitTime - now
    if (remaining <= 0) return 'Ready to finalize'
    const hours = Math.floor(remaining / 3600)
    const minutes = Math.floor((remaining % 3600) / 60)
    return `${hours}h ${minutes}m remaining`
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      {/* Withdraw Form */}
      <form onSubmit={handleWithdraw} className="space-y-6 bg-black/40 backdrop-blur-xl p-8 rounded-2xl border border-white/10 shadow-2xl">
        <div className="space-y-2">
          <h3 className="text-xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent flex items-center gap-2">
            <ArrowUpCircle className="w-5 h-5 text-orange-400" />
            Withdraw to L1
          </h3>
          <p className="text-sm text-gray-400">Exit tokens from L2 to Sepolia using aggregated withdrawal.</p>
        </div>

        <div className="space-y-4">
          {/* Network Status */}
          <div className="p-3 rounded-lg bg-white/5 border border-white/10 flex justify-between items-center">
            <span className="text-sm text-gray-400">Current Network:</span>
            <span className={cn(
              "font-medium",
              isOnL2 ? "text-green-400" : isOnL1 ? "text-blue-400" : "text-yellow-400"
            )}>
              {isOnL2 ? "Plasma L2" : isOnL1 ? "Sepolia (L1)" : "Unknown"}
            </span>
          </div>

          {/* UTXO Info */}
          <div className="p-3 rounded-lg bg-white/5 border border-white/10 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="text-sm text-gray-400">L2 Balance:</span>
            </div>
            <div className="flex items-center gap-2">
              {isLoadingUtxos ? (
                <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
              ) : (
                <>
                  <span className="font-mono font-medium">{userUtxos.length} UTXOs</span>
                  <span className="text-gray-500">|</span>
                  <span className="font-mono font-medium text-orange-400">{maxBalance} PLASMA</span>
                </>
              )}
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</label>
              <span className="text-xs text-gray-400">
                Available: {maxBalance} PLASMA
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                step="0.0001"
                placeholder="0.00"
                className={cn(
                  "w-full p-3 pr-20 rounded-lg bg-black/50 border text-lg font-mono focus:outline-none transition-colors",
                  isInsufficientBalance
                    ? "border-red-500/50 focus:border-red-500"
                    : "border-white/10 focus:border-orange-500/50"
                )}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isProcessing}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAmount(maxBalance)}
                  className="text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors px-2 py-1 rounded hover:bg-orange-500/10"
                  disabled={isProcessing}
                >
                  MAX
                </button>
                <span className="text-sm font-medium text-gray-500">
                  PLASMA
                </span>
              </div>
            </div>
            {isInsufficientBalance && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Insufficient balance. Maximum: {maxBalance} PLASMA
              </p>
            )}
          </div>

          {/* Info Box */}
          <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-300 text-xs space-y-1">
            <p className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Withdrawal process (aggregated):
            </p>
            <ol className="list-decimal list-inside opacity-70 space-y-0.5 ml-2">
              <li>Aggregate UTXOs on L2 (operator)</li>
              <li>Register Exit UTXO on L1 (operator)</li>
              <li>Start exit on L1 with witness proof</li>
              <li>Wait for challenge period (~7 days)</li>
              <li>Finalize exit to receive tokens</li>
            </ol>
          </div>
        </div>

        {/* Status Messages */}
        {errorMessage && currentStep === 'error' && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {currentStep === 'sign' && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Step 1/8: Signing aggregation request...</span>
          </div>
        )}

        {currentStep === 'aggregate' && (
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Step 2/8: Aggregating UTXOs on L2 (operator)...</span>
          </div>
        )}

        {currentStep === 'create_block' && (
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Step 3/8: Creating L2 block (operator)...</span>
          </div>
        )}

        {currentStep === 'accumulator' && (
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Step 4/8: Adding Exit UTXO to accumulator...</span>
          </div>
        )}

        {currentStep === 'submit_block' && (
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Step 5/8: Submitting block to L1...</span>
          </div>
        )}

        {currentStep === 'register_exit' && (
          <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Step 6/8: Registering Exit UTXO on L1 (operator)...</span>
          </div>
        )}

        {currentStep === 'get_witness' && (
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Step 7/8: Getting witness proof from backend...</span>
          </div>
        )}

        {currentStep === 'l1_exit' && (
          <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Step 8/8: Starting exit on L1 (confirm in wallet)...</span>
          </div>
        )}

        {currentStep === 'success' && successResult && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              <span>Exit started successfully!</span>
            </div>
            <div className="pl-6 text-xs opacity-70 space-y-1">
              <p>Amount: {successResult.amount} PLASMA</p>
              {successResult.exitId && (
                <p className="font-mono text-xs">Exit ID: {successResult.exitId.slice(0, 10)}...{successResult.exitId.slice(-8)}</p>
              )}
              {successResult.l1TxHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${successResult.l1TxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-green-300 flex items-center gap-1"
                >
                  View on Etherscan <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <p className="text-yellow-400 mt-2">Wait for challenge period, then finalize exit on L1.</p>
            </div>
          </div>
        )}

        {!isOnL2 ? (
          <button
            type="button"
            onClick={() => switchChain({ chainId: 31337 })}
            className="w-full py-3 rounded-lg bg-yellow-500/20 border border-yellow-500/50 text-yellow-500 font-medium hover:bg-yellow-500/30 transition-all flex items-center justify-center gap-2"
          >
            <Network className="w-4 h-4" />
            Switch to Plasma L2
          </button>
        ) : (
          <button
            type="submit"
            disabled={!contractConfig || isProcessing || !amount || isInsufficientBalance || userUtxos.length === 0 || !walletClient}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-orange-500 to-red-600 text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                Start Withdrawal
                <ArrowUpCircle className="w-4 h-4" />
              </>
            )}
          </button>
        )}
      </form>

      <div className="space-y-6 bg-black/40 backdrop-blur-xl p-8 rounded-2xl border border-white/10 shadow-2xl">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            Finalize Exit
          </h3>
          <p className="text-sm text-gray-400">Finalize exit after the challenge period ends.</p>
        </div>

        <label className="flex items-center gap-3 text-xs text-gray-400">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-white/20 bg-black/40 text-green-500 focus:ring-green-500/40"
            checked={autoFinalizeEnabled}
            onChange={(e) => {
              setAutoFinalizeEnabled(e.target.checked)
              if (!e.target.checked) {
                setAutoFinalizeAttempted({})
              }
            }}
          />
          Auto finalize when ready (wallet confirmation required)
        </label>

        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Exit ID</label>
          <input
            type="text"
            placeholder="0x..."
            className="w-full p-3 rounded-lg bg-black/50 border border-white/10 text-sm font-mono focus:outline-none focus:border-green-500/50 transition-colors"
            value={finalizeExitId}
            onChange={(e) => setFinalizeExitId(e.target.value)}
            disabled={isFinalizing}
          />
        </div>

        {finalizeError && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{finalizeError}</span>
          </div>
        )}

        {finalizeHash && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm space-y-1">
            <p>Finalize submitted.</p>
            <a
              href={`https://sepolia.etherscan.io/tx/${finalizeHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-green-300 flex items-center gap-1"
            >
              View on Etherscan <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        <button
          type="button"
          onClick={() => handleFinalizeExit()}
          disabled={!walletClient || !finalizeExitId || isFinalizing}
          className="w-full py-3 rounded-lg bg-green-500/20 border border-green-500/50 text-green-400 font-medium hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {isFinalizing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Finalizing...
            </>
          ) : (
            <>
              Finalize Exit
              <ArrowUpCircle className="w-4 h-4" />
            </>
          )}
        </button>
      </div>

      <div className="space-y-6 bg-black/40 backdrop-blur-xl p-8 rounded-2xl border border-white/10 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-yellow-400" />
              Withdrawal History
            </h3>
            <p className="text-sm text-gray-400">Saved locally for this browser.</p>
          </div>
          <button
            type="button"
            onClick={() => setHistoryOpen((prev) => !prev)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10 transition-all"
          >
            {historyOpen ? 'Hide' : 'Show'}
          </button>
        </div>

        {historyOpen && (
          <>
            {withdrawHistory.length === 0 ? (
              <div className="text-sm text-gray-500">No withdrawals yet.</div>
            ) : (
              <div className="space-y-3">
                {withdrawHistory.map((item) => {
                  const status = exitStatuses[item.exitId]
                  const isReady = status?.exitTime ? now >= status.exitTime : false
                  const label = status?.challenged
                    ? 'Challenged'
                    : status?.processed
                      ? 'Finalized'
                      : isReady
                        ? 'Ready'
                        : 'Waiting'

                  return (
                    <div
                      key={item.exitId}
                      className="p-4 rounded-lg bg-white/5 border border-white/10 flex flex-col gap-3"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="font-mono text-xs text-gray-300">
                            Exit ID: {item.exitId.slice(0, 10)}...{item.exitId.slice(-8)}
                          </div>
                          <div className="text-xs text-gray-500">Amount: {item.amount} PLASMA</div>
                          <div className="text-xs text-gray-500">
                            Challenge: {formatTimeRemaining(status?.exitTime)}
                          </div>
                        </div>
                        <div className={cn(
                          "text-xs font-medium px-2 py-1 rounded-full border",
                          label === 'Ready'
                            ? "text-green-400 border-green-500/40 bg-green-500/10"
                            : label === 'Finalized'
                              ? "text-blue-400 border-blue-500/40 bg-blue-500/10"
                              : label === 'Challenged'
                                ? "text-red-400 border-red-500/40 bg-red-500/10"
                                : "text-yellow-400 border-yellow-500/40 bg-yellow-500/10"
                        )}>
                          {label}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setFinalizeExitId(item.exitId)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10 transition-all"
                        >
                          Use Exit ID
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFinalizeExit(item.exitId)}
                          disabled={!isReady || status?.processed || status?.challenged || isFinalizing}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          Finalize
                        </button>
                        {item.l1TxHash && (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${item.l1TxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10 transition-all"
                          >
                            L1 Tx
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

    </div>
  )
}
