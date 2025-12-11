import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, useChainId, useSwitchChain } from 'wagmi'
import { parseEther, formatEther, type Address } from 'viem'
import { cn } from '../utils'
import PlasmaChainABI from '../abis/PlasmaChain.json'
import { Send, Loader2, CheckCircle, AlertCircle, Wallet, Network, Clock } from 'lucide-react'

// Environment variables
const L2_PLASMA_CHAIN_ADDRESS = import.meta.env.VITE_L2_PLASMA_CHAIN_ADDRESS as Address || '0xA9639c9bA80dcF06e858C6495a72e4661C059Fe3'
const L2_PLASMA_TOKEN_ADDRESS = import.meta.env.VITE_L2_PLASMA_TOKEN_ADDRESS as Address || '0x17A7428596776A82b9E2D11fd7c523e8e1BA92B1'

const PREDEFINED_ACCOUNTS = [
  { address: '0x62dc14Fe819A241e176ee6A813f51045d04A0cda', label: 'Account A (0x62dc...)' },
  { address: '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76', label: 'Account B (0xba4B...)' },
  { address: '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab', label: 'Account C (0xfa54...)' },
] as const

export function TransferForm() {
  const { address: connectedAddress, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  
  const [toAddress, setToAddress] = useState<string>(PREDEFINED_ACCOUNTS[0].address)
  const [amount, setAmount] = useState('')
  const [isCustomAddress, setIsCustomAddress] = useState(false)

  const { data: hash, isPending: isWritePending, writeContract, error: writeError } = useWriteContract()
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  // Fetch Nonce
  const { data: nonce } = useReadContract({
    address: L2_PLASMA_CHAIN_ADDRESS,
    abi: PlasmaChainABI.abi,
    functionName: 'nonces',
    args: connectedAddress ? [connectedAddress] : undefined,
    query: {
        enabled: !!connectedAddress && chainId === 31337
    }
  })
  
  // Fetch Balance
  const { data: balance } = useReadContract({
    address: L2_PLASMA_CHAIN_ADDRESS,
    abi: PlasmaChainABI.abi,
    functionName: 'getBalance',
    args: connectedAddress ? [connectedAddress, L2_PLASMA_TOKEN_ADDRESS] : undefined,
    query: {
        enabled: !!connectedAddress && chainId === 31337
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!connectedAddress || !amount || !toAddress) return

    try {
        const parsedAmount = parseEther(amount)
        const currentNonce = nonce as bigint || 0n

        writeContract({
            address: L2_PLASMA_CHAIN_ADDRESS,
            abi: PlasmaChainABI.abi,
            functionName: 'executeTransaction',
            args: [
                connectedAddress,       // from
                toAddress as Address,   // to
                L2_PLASMA_TOKEN_ADDRESS,// token
                parsedAmount,           // amount
                currentNonce,           // nonce
                '0x',                   // signature (empty for direct call)
            ],
            chainId: 31337,
        })
    } catch (err) {
        console.error("Transfer failed", err)
    }
  }

  useEffect(() => {
    if (isConfirmed) {
        setAmount('')
    }
  }, [isConfirmed])

  if (!isConnected) {
    return (
        <div className="flex flex-col items-center justify-center p-12 text-center space-y-4 bg-white/5 rounded-xl border border-white/10">
            <Wallet className="w-12 h-12 text-gray-500" />
            <h3 className="text-xl font-semibold">Wallet Not Connected</h3>
            <p className="text-gray-400">Please connect your wallet to make transfers.</p>
        </div>
    )
  }

  const isWrongNetwork = chainId !== 31337

  return (
    <div className="w-full max-w-md mx-auto">
      <form onSubmit={handleSubmit} className="space-y-6 bg-black/40 backdrop-blur-xl p-8 rounded-2xl border border-white/10 shadow-2xl">
        <div className="space-y-2">
            <h3 className="text-xl font-bold bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent flex items-center gap-2">
                <Send className="w-5 h-5 text-green-400" />
                Transfer Plasma
            </h3>
            <p className="text-sm text-gray-400">Send tokens instantly on Layer 2.</p>
        </div>

        <div className="space-y-4">
            {/* From (Read-only) */}
            <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">From</label>
                <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm font-mono text-gray-300 break-all">
                    {connectedAddress}
                </div>
            </div>

            {/* To Selection */}
            <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">To</label>
                <div className="space-y-2">
                    <select 
                        className="w-full p-3 rounded-lg bg-black/50 border border-white/10 text-sm focus:outline-none focus:border-green-500/50 transition-colors"
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
                            className="w-full p-3 rounded-lg bg-black/50 border border-white/10 text-sm font-mono focus:outline-none focus:border-green-500/50 transition-colors"
                            value={toAddress}
                            onChange={(e) => setToAddress(e.target.value)}
                        />
                    )}
                </div>
            </div>

            {/* Amount */}
            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</label>
                    <span className="text-xs text-gray-400">
                        Balance: {balance ? formatEther(balance as bigint) : '0'} PLASMA
                    </span>
                </div>
                <div className="relative">
                    <input 
                        type="number" 
                        step="0.0001"
                        placeholder="0.00" 
                        className="w-full p-3 rounded-lg bg-black/50 border border-white/10 text-lg font-mono focus:outline-none focus:border-green-500/50 transition-colors"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500">
                        PLASMA
                    </div>
                </div>
                <p className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Estimated time: Instant (~2s)
                </p>
            </div>
        </div>

        {/* Status Messages */}
        {writeError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{writeError.message.split('\n')[0]}</span>
            </div>
        )}

        {hash && (
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm flex items-start gap-2 break-all">
                <Loader2 className={cn("w-4 h-4 mt-0.5 shrink-0", isConfirming && "animate-spin")} />
                <div className="space-y-1">
                    <p className="font-medium">{isConfirming ? 'Confirming...' : 'Transaction Sent'}</p>
                    <p className="text-xs opacity-70">{hash}</p>
                </div>
            </div>
        )}

        {isConfirmed && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                <span>Transfer successful!</span>
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
                disabled={isWritePending || isConfirming || !amount || !toAddress}
                className="w-full py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
            >
                {isWritePending || isConfirming ? (
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
