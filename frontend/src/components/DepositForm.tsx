import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, useChainId, useSwitchChain } from 'wagmi'
import { parseEther, type Address, formatEther } from 'viem'
import { cn } from '../utils'
import { getContractConfig, type ContractConfig } from '../utils/config'
import RootChainUTXOABI from '../abis/RootChainUTXO.json'
import PlasmaTokenABI from '../abis/PlasmaToken.json'
import { ArrowDownCircle, Loader2, CheckCircle, AlertCircle, Wallet, Network } from 'lucide-react'
import { sepolia } from 'wagmi/chains'

export function DepositForm() {
  const { address: connectedAddress, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()

  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'input' | 'approving' | 'depositing' | 'success'>('input')
  const [contractConfig, setContractConfig] = useState<ContractConfig | null>(null)
  const [utxoId, setUtxoId] = useState<string | null>(null)

  // Load contract config on mount
  useEffect(() => {
    getContractConfig().then(setContractConfig)
  }, [])

  // Contract Writes
  const { data: approveHash, isPending: isApprovePending, writeContract: writeApprove, error: approveError } = useWriteContract()
  const { data: depositHash, isPending: isDepositPending, writeContract: writeDeposit, error: depositError } = useWriteContract()

  // Transaction Receipts
  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({
    hash: approveHash,
  })

  const { isLoading: isDepositConfirming, isSuccess: isDepositConfirmed, data: depositReceipt } = useWaitForTransactionReceipt({
    hash: depositHash,
  })

  // Read Balance and Allowance
  const { data: balance } = useReadContract({
    address: contractConfig?.PLASMA_TOKEN_ADDRESS as Address,
    abi: PlasmaTokenABI.abi,
    functionName: 'balanceOf',
    args: connectedAddress ? [connectedAddress] : undefined,
    query: {
      enabled: !!connectedAddress && chainId === sepolia.id && !!contractConfig
    }
  })

  const { refetch: refetchAllowance } = useReadContract({
    address: contractConfig?.PLASMA_TOKEN_ADDRESS as Address,
    abi: PlasmaTokenABI.abi,
    functionName: 'allowance',
    args: connectedAddress ? [connectedAddress, contractConfig?.ROOT_CHAIN_UTXO_ADDRESS as Address] : undefined,
    query: {
      enabled: !!connectedAddress && chainId === sepolia.id && !!contractConfig
    }
  })

  const handleApprove = (e: React.FormEvent) => {
    e.preventDefault()
    if (!connectedAddress || !amount || !contractConfig) {
      console.error('Missing required fields:', { connectedAddress, amount, contractConfig })
      return
    }

    if (!contractConfig.PLASMA_TOKEN_ADDRESS || !contractConfig.ROOT_CHAIN_UTXO_ADDRESS) {
      console.error('Missing contract addresses:', contractConfig)
      return
    }

    try {
      const parsedAmount = parseEther(amount)
      console.log('Approving:', {
        token: contractConfig.PLASMA_TOKEN_ADDRESS,
        spender: contractConfig.ROOT_CHAIN_UTXO_ADDRESS,
        amount: parsedAmount.toString()
      })
      writeApprove({
        address: contractConfig.PLASMA_TOKEN_ADDRESS as Address,
        abi: PlasmaTokenABI.abi,
        functionName: 'approve',
        args: [contractConfig.ROOT_CHAIN_UTXO_ADDRESS as Address, parsedAmount],
        chainId: sepolia.id,
      })
      setStep('approving')
    } catch (err) {
      console.error("Approve failed", err)
    }
  }

  const handleDeposit = () => {
    if (!connectedAddress || !amount || !contractConfig) return

    try {
      const parsedAmount = parseEther(amount)
      writeDeposit({
        address: contractConfig.ROOT_CHAIN_UTXO_ADDRESS as Address,
        abi: RootChainUTXOABI,
        functionName: 'deposit',
        args: [contractConfig.PLASMA_TOKEN_ADDRESS as Address, parsedAmount],
        chainId: sepolia.id,
      })
      setStep('depositing')
    } catch (err) {
      console.error("Deposit failed", err)
    }
  }

  // Effect to handle state transitions
  useEffect(() => {
    if (isApproveConfirmed) {
      refetchAllowance()
      handleDeposit()
    }
  }, [isApproveConfirmed])

  useEffect(() => {
    if (isDepositConfirmed && depositReceipt) {
      // Try to extract UTXO ID from logs
      const depositLog = depositReceipt.logs.find(log =>
        log.topics[0] === '0x' // DepositCreated event topic - would need actual topic
      )
      if (depositLog && depositLog.topics[1]) {
        setUtxoId(depositLog.topics[1])
      }
      setStep('success')
      setAmount('')
    }
  }, [isDepositConfirmed, depositReceipt])

  if (!isConnected) {
    return (
      <div className="app-panel mx-auto flex max-w-xl flex-col items-center justify-center space-y-4 border-dashed p-10 text-center">
        <Wallet className="h-12 w-12 text-slate-500" />
        <h3 className="text-xl font-semibold">Wallet Not Connected</h3>
        <p className="max-w-sm text-sm text-slate-400">Please connect your wallet to make deposits.</p>
      </div>
    )
  }

  if (!contractConfig) {
    return (
      <div className="app-panel mx-auto flex max-w-xl flex-col items-center justify-center space-y-4 border-dashed p-10 text-center">
        <Loader2 className="h-12 w-12 animate-spin text-slate-500" />
        <h3 className="text-xl font-semibold">Loading Configuration</h3>
        <p className="max-w-sm text-sm text-slate-400">Fetching contract addresses from backend...</p>
      </div>
    )
  }

  const isWrongNetwork = chainId !== sepolia.id

  return (
    <div className="w-full max-w-xl mx-auto">
      <div className="app-panel space-y-6 p-6 sm:p-8">
        <div className="space-y-2">
          <p className="muted-label">Sepolia to Plasma L2</p>
          <h3 className="flex items-center gap-2 text-2xl font-bold text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-400/10 text-blue-300">
              <ArrowDownCircle className="h-5 w-5" />
            </span>
            Deposit to Layer 2
          </h3>
          <p className="text-sm text-slate-400">Move tokens from Sepolia to Plasma L2. Creates a new UTXO on L2.</p>
        </div>

        <div className="space-y-4">
          {/* Balance Info */}
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <span className="text-sm text-slate-400">L1 Balance:</span>
            <span className="font-mono font-medium">
              {balance ? formatEther(balance as bigint) : '0'} PLASMA
            </span>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase text-slate-500">Amount</label>
            <div className="relative">
              <input
                type="number"
                step="0.0001"
                placeholder="0.00"
                className="focus-ring w-full rounded-lg border border-white/10 bg-slate-950/70 p-3 text-lg font-mono transition-colors focus:border-blue-400/60"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={step !== 'input' && step !== 'success'}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500">
                PLASMA
              </div>
            </div>
          </div>
        </div>

        {/* Status Messages */}
        {(approveError || depositError) && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{(approveError || depositError)?.message.split('\n')[0]}</span>
          </div>
        )}

        {/* Progress Steps */}
        {(step === 'approving' || step === 'depositing') && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <div className={cn("w-6 h-6 rounded-full flex items-center justify-center border",
                step === 'approving' ? "border-blue-500 text-blue-500" : "border-green-500 bg-green-500/20 text-green-500"
              )}>
                {(step === 'approving' && (isApprovePending || isApproveConfirming)) ? <Loader2 className="w-3 h-3 animate-spin" /> : "1"}
              </div>
              <div className="flex flex-col">
                <span className={step === 'approving' ? "text-white" : "text-gray-500"}>
                  Approve Tokens
                </span>
                {step === 'approving' && (
                  <span className="text-xs text-blue-400">
                    {isApprovePending ? 'Waiting for signature...' : isApproveConfirming ? 'Confirming transaction...' : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="w-0.5 h-4 bg-white/10 ml-3" />
            <div className="flex items-center gap-3 text-sm">
              <div className={cn("w-6 h-6 rounded-full flex items-center justify-center border",
                step === 'depositing' ? "border-blue-500 text-blue-500" : "border-white/10 text-gray-500"
              )}>
                {(step === 'depositing' && (isDepositPending || isDepositConfirming)) ? <Loader2 className="w-3 h-3 animate-spin" /> : "2"}
              </div>
              <div className="flex flex-col">
                <span className={step === 'depositing' ? "text-white" : "text-gray-500"}>
                  Deposit to L2 (Create UTXO)
                </span>
                {step === 'depositing' && (
                  <span className="text-xs text-blue-400">
                    {isDepositPending ? 'Waiting for signature...' : isDepositConfirming ? 'Confirming transaction...' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              <span>Deposit successful! UTXO will appear on L2 shortly.</span>
            </div>
            {depositHash && (
              <div className="pl-6 text-xs opacity-80 break-all">
                <p>TX: {depositHash}</p>
                <a
                  href={`https://sepolia.etherscan.io/tx/${depositHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-green-300 mt-1 inline-block"
                >
                  View on Etherscan
                </a>
              </div>
            )}
            {utxoId && (
              <div className="pl-6 text-xs opacity-80">
                <p>UTXO ID: {utxoId.slice(0, 20)}...</p>
              </div>
            )}
          </div>
        )}

        {isWrongNetwork ? (
          <button
            type="button"
            onClick={() => switchChain({ chainId: sepolia.id })}
            className="w-full py-3 rounded-lg bg-yellow-500/20 border border-yellow-500/50 text-yellow-500 font-medium hover:bg-yellow-500/30 transition-all flex items-center justify-center gap-2"
          >
            <Network className="w-4 h-4" />
            Switch to Sepolia
          </button>
        ) : (
          <button
            onClick={handleApprove}
            disabled={!contractConfig || step !== 'input' && step !== 'success' || !amount}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
          >
            {step === 'approving' || step === 'depositing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                Start Deposit
                <ArrowDownCircle className="w-4 h-4" />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
