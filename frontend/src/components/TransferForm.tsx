import { useState, useEffect } from 'react'
import { useAccount, usePublicClient, useChainId, useSwitchChain, useWalletClient } from 'wagmi'
import { parseEther, formatEther, type Address, type Hex, keccak256, encodePacked, parseEventLogs } from 'viem'
import { cn } from '../utils'
import { getContractConfig, getBackendApiUrl, type ContractConfig } from '../utils/config'
import PlasmaChainUTXOABI from '../abis/PlasmaChainUTXO.json'
import { Send, Loader2, CheckCircle, AlertCircle, Wallet, Network, Clock, Coins } from 'lucide-react'

const PREDEFINED_ACCOUNTS = [
  { address: '0x62dc14Fe819A241e176ee6A813f51045d04A0cda', label: 'User A (0x62dc...)' },
  { address: '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76', label: 'User B (0xba4B...)' },
  { address: '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab', label: 'User C (0xfa54...)' },
] as const

interface UTXO {
  utxoId: Hex
  owner: string
  token: string
  amount: bigint
  spent: boolean
  blockNumber: number
}

export function TransferForm() {
  const { address: connectedAddress, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const l2Client = usePublicClient({ chainId: 31337 })
  const { data: walletClient } = useWalletClient()

  const [toAddress, setToAddress] = useState<string>(PREDEFINED_ACCOUNTS[0].address)
  const [amount, setAmount] = useState('')
  const [isCustomAddress, setIsCustomAddress] = useState(false)
  const [contractConfig, setContractConfig] = useState<ContractConfig | null>(null)

  const [userUtxos, setUserUtxos] = useState<UTXO[]>([])
  const [totalBalance, setTotalBalance] = useState(0n)
  const [isLoadingUtxos, setIsLoadingUtxos] = useState(false)

  const [isTransferring, setIsTransferring] = useState(false)
  const [transferStatus, setTransferStatus] = useState<'idle' | 'signing' | 'submitting' | 'success' | 'error'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [outputUtxos, setOutputUtxos] = useState<string[]>([])

  // Load contract config on mount
  useEffect(() => {
    getContractConfig().then(setContractConfig)
  }, [])

  // Fetch user's UTXOs
  useEffect(() => {
    if (!connectedAddress || !contractConfig || !l2Client || chainId !== 31337) return

    const fetchUtxos = async () => {
      setIsLoadingUtxos(true)
      try {
        const utxoIds = await l2Client.readContract({
          address: contractConfig.PLASMA_CHAIN_UTXO_ADDRESS as Address,
          abi: PlasmaChainUTXOABI,
          functionName: 'getUserUtxos',
          args: [connectedAddress],
        }) as Hex[]

        const utxos: UTXO[] = []
        let total = 0n

        for (const utxoId of utxoIds) {
          try {
            const utxoData = await l2Client.readContract({
              address: contractConfig.PLASMA_CHAIN_UTXO_ADDRESS as Address,
              abi: PlasmaChainUTXOABI,
              functionName: 'utxos',
              args: [utxoId],
            }) as [Hex, Address, Address, bigint, bigint, boolean, Hex]
            // utxos() returns: utxoId, owner, token, amount, createdInBlock, spent, spentInTx

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
  }, [connectedAddress, contractConfig, l2Client, chainId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!connectedAddress || !amount || !toAddress || !contractConfig || !l2Client || !walletClient) return

    setIsTransferring(true)
    setTransferStatus('signing')
    setErrorMessage(null)
    setTxHash(null)
    setOutputUtxos([])

    try {
      const parsedAmount = parseEther(amount)
      const token = contractConfig.L2_PLASMA_TOKEN_ADDRESS as Address

      // 1. Select UTXOs to cover the amount
      const sortedUtxos = [...userUtxos]
        .filter(u => u.token.toLowerCase() === token.toLowerCase())
        .sort((a, b) => (b.amount > a.amount ? 1 : -1))

      const inputUtxoIds: Hex[] = []
      let totalInput = 0n

      for (const utxo of sortedUtxos) {
        if (totalInput >= parsedAmount) break
        inputUtxoIds.push(utxo.utxoId)
        totalInput += utxo.amount
      }

      if (totalInput < parsedAmount) {
        throw new Error(`Insufficient balance. Have: ${formatEther(totalInput)}, Need: ${formatEther(parsedAmount)}`)
      }

      // 2. Calculate change
      const change = totalInput - parsedAmount

      // 3. Prepare outputs
      const outputOwners: Address[] = [toAddress as Address]
      const outputAmounts: bigint[] = [parsedAmount]

      if (change > 0n) {
        outputOwners.push(connectedAddress)
        outputAmounts.push(change)
      }

      // 4. Get nonce from contract
      const nonce = await l2Client.readContract({
        address: contractConfig.PLASMA_CHAIN_UTXO_ADDRESS as Address,
        abi: PlasmaChainUTXOABI,
        functionName: 'nonces',
        args: [connectedAddress],
      }) as bigint

      // 5. Create message hash matching contract's expectation
      const messageHash = keccak256(
        encodePacked(
          ['bytes32[]', 'address[]', 'uint256[]', 'uint256'],
          [inputUtxoIds, outputOwners, outputAmounts, nonce]
        )
      )

      // 6. Sign the message
      const signature = await walletClient.signMessage({
        message: { raw: messageHash },
      })

      setTransferStatus('submitting')

      // 7. Execute transfer directly on contract
      // @ts-ignore - ABI type inference issue with JSON import
      const hash = await walletClient.writeContract({
        address: contractConfig.PLASMA_CHAIN_UTXO_ADDRESS as Address,
        abi: PlasmaChainUTXOABI,
        functionName: 'transferUtxo',
        args: [inputUtxoIds, outputOwners, outputAmounts, signature],
      })

      // Wait for receipt
      const receipt = await l2Client.waitForTransactionReceipt({ hash })
      const succeeded = receipt.status === 'success'
      if (!succeeded) {
        throw new Error('Transfer transaction reverted on L2')
      }

      const createdLogs = parseEventLogs({
        abi: PlasmaChainUTXOABI,
        logs: receipt.logs,
        eventName: 'UtxoCreated',
        strict: false,
      })

      const newUtxos = createdLogs.map((log: any) => ({
        utxoId: log.args?.utxoId,
        owner: log.args?.owner,
        amount: log.args?.amount,
      })).filter((utxo) => Boolean(utxo.utxoId))

      const newUtxoIds = newUtxos.map((utxo) => utxo.utxoId)

      setTxHash(hash)
      setOutputUtxos(newUtxoIds)
      setTransferStatus('success')
      setAmount('')

      const backendUrl = getBackendApiUrl()
      await Promise.all(newUtxos.map(async (utxo) => {
        try {
          await fetch(`${backendUrl}/api/transactions/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'UTXO_TRANSFER',
              utxoId: utxo.utxoId,
              txHash: hash,
              from: connectedAddress,
              to: utxo.owner,
              token,
              amount: utxo.amount.toString(),
            }),
          })
        } catch (error) {
          console.warn('Failed to notify backend for UTXO:', utxo.utxoId, error)
        }
      }))
    } catch (err: any) {
      console.error('Transfer failed:', err)
      setErrorMessage(err.message || 'Transfer failed')
      setTransferStatus('error')
    } finally {
      setIsTransferring(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="app-panel mx-auto flex max-w-xl flex-col items-center justify-center space-y-4 border-dashed p-10 text-center">
        <Wallet className="h-12 w-12 text-slate-500" />
        <h3 className="text-xl font-semibold">Wallet Not Connected</h3>
        <p className="max-w-sm text-sm text-slate-400">Please connect your wallet to make transfers.</p>
      </div>
    )
  }

  if (!contractConfig) {
    return (
      <div className="app-panel mx-auto flex max-w-xl flex-col items-center justify-center space-y-4 border-dashed p-10 text-center">
        <Loader2 className="h-12 w-12 animate-spin text-slate-500" />
        <h3 className="text-xl font-semibold">Loading Configuration</h3>
        <p className="max-w-sm text-slate-400">Fetching contract addresses from backend...</p>
      </div>
    )
  }

  const isWrongNetwork = chainId !== 31337

  // Calculate if amount exceeds balance
  const amountBigInt = amount ? parseEther(amount) : 0n
  const isInsufficientBalance = amountBigInt > totalBalance && amount !== ''
  const maxBalance = formatEther(totalBalance)

  return (
    <div className="w-full max-w-xl mx-auto">
      <form onSubmit={handleSubmit} className="app-panel space-y-6 p-6 sm:p-8">
        <div className="space-y-2">
          <p className="muted-label">Plasma L2 operation</p>
          <h3 className="flex items-center gap-2 text-2xl font-bold text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">
              <Send className="h-5 w-5" />
            </span>
            UTXO Transfer
          </h3>
          <p className="text-sm text-slate-400">Send tokens using UTXO model on Layer 2.</p>
        </div>

        <div className="space-y-4">
          {/* From (Read-only) */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase text-slate-500">From</label>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm font-mono text-slate-300 break-all">
              {connectedAddress}
            </div>
          </div>

          {/* UTXO Info */}
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="text-sm text-slate-400">Available UTXOs:</span>
            </div>
            <div className="flex items-center gap-2">
              {isLoadingUtxos ? (
                <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
              ) : (
                <>
                  <span className="font-mono font-medium">{userUtxos.length}</span>
                  <span className="text-gray-500">|</span>
                  <span className="font-mono font-medium text-green-400">{maxBalance} PLASMA</span>
                </>
              )}
            </div>
          </div>

          {/* To Selection */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase text-slate-500">To</label>
            <div className="space-y-2">
              <select
                className="focus-ring w-full rounded-lg border border-white/10 bg-slate-950/70 p-3 text-sm transition-colors focus:border-emerald-400/60"
                value={isCustomAddress ? 'custom' : toAddress}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setIsCustomAddress(true)
                    setToAddress('')
                  } else {
                    setIsCustomAddress(false)
                    setToAddress(e.target.value)
                  }
                }}
              >
                {PREDEFINED_ACCOUNTS.map(acc => (
                  <option key={acc.address} value={acc.address}>
                    {acc.label}
                  </option>
                ))}
                <option value="custom">Custom Address...</option>
              </select>

              {isCustomAddress && (
                <input
                  type="text"
                  placeholder="0x..."
                  className="focus-ring w-full rounded-lg border border-white/10 bg-slate-950/70 p-3 text-sm font-mono transition-colors focus:border-emerald-400/60"
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                />
              )}
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-medium uppercase text-slate-500">Amount</label>
              <span className="text-xs text-gray-400">
                Balance: {maxBalance} PLASMA
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                step="0.0001"
                placeholder="0.00"
                className={cn(
                  "focus-ring w-full rounded-lg border bg-slate-950/70 p-3 pr-20 text-lg font-mono transition-colors",
                  isInsufficientBalance
                    ? "border-red-500/50 focus:border-red-500"
                    : "border-white/10 focus:border-emerald-400/60"
                )}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isTransferring}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAmount(maxBalance)}
                  className="text-xs font-medium text-green-400 hover:text-green-300 transition-colors px-2 py-1 rounded hover:bg-green-500/10"
                  disabled={isTransferring}
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
            {!isInsufficientBalance && userUtxos.length > 0 && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                UTXO transfer - instant on L2
              </p>
            )}
          </div>
        </div>

        {/* Status Messages */}
        {errorMessage && transferStatus === 'error' && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {transferStatus === 'signing' && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Please sign the message in your wallet...</span>
          </div>
        )}

        {transferStatus === 'submitting' && (
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Submitting transfer to L2...</span>
          </div>
        )}

        {transferStatus === 'success' && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              <span>Transfer successful!</span>
            </div>
            {txHash && (
              <p className="text-xs opacity-70 font-mono break-all pl-6">
                TX: {txHash}
              </p>
            )}
            {outputUtxos.length > 0 && (
              <div className="pl-6 text-xs opacity-70">
                <p>Created {outputUtxos.length} new UTXO(s)</p>
              </div>
            )}
          </div>
        )}

        {isWrongNetwork ? (
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
            disabled={!contractConfig || isTransferring || !amount || !toAddress || isInsufficientBalance || userUtxos.length === 0}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
          >
            {isTransferring ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                Send Tokens
                <Send className="w-4 h-4" />
              </>
            )}
          </button>
        )}
      </form>
    </div>
  )
}
