import { useState, useEffect } from 'react'
import { useReadContracts, usePublicClient, useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { formatEther, type Address } from 'viem'
import { cn } from '../utils'
import { getContractConfig } from '../utils/config'
import PlasmaChainABI from '../abis/PlasmaChain.json'
import PlasmaTokenABI from '../abis/PlasmaToken.json'
import { RefreshCw, Layers, Database, Loader2 } from 'lucide-react'

interface BalanceTableProps {
  addresses: Address[]
}

export function BalanceTable({ addresses }: BalanceTableProps) {
  const [showL1, setShowL1] = useState(false)
  const [contractAddresses, setContractAddresses] = useState<{
    L2_PLASMA_CHAIN_ADDRESS?: string
    L2_PLASMA_TOKEN_ADDRESS?: string
    PLASMA_TOKEN_ADDRESS?: string
  } | null>(null)
  const { address: connectedAddress } = useAccount()
  
  const l2Client = usePublicClient({ chainId: 31337 })
  const l1Client = usePublicClient({ chainId: 11155111 }) // Sepolia

  // Load contract addresses from backend on mount
  useEffect(() => {
    getContractConfig().then(setContractAddresses)
  }, [])

  // 1. Fetch L2 Native ETH Balances (Native)
  const { data: l2EthBalances, refetch: refetchL2Eth } = useQuery({
    queryKey: ['l2-eth-balances', addresses],
    queryFn: async () => {
      if (!l2Client) return null
      return Promise.all(addresses.map(addr => l2Client.getBalance({ address: addr })))
    },
    refetchInterval: 2000,
  })

  // 2. Fetch L2 Token & Nonce (Contract)
  const { data: l2ContractData, refetch: refetchL2Contract } = useReadContracts({
    contracts: contractAddresses ? addresses.flatMap(address => [
      {
        address: contractAddresses.L2_PLASMA_CHAIN_ADDRESS as Address,
        abi: PlasmaChainABI.abi as any,
        functionName: 'getBalance',
        args: [address, contractAddresses.L2_PLASMA_TOKEN_ADDRESS as Address],
        chainId: 31337,
      },
      {
        address: contractAddresses.L2_PLASMA_CHAIN_ADDRESS as Address,
        abi: PlasmaChainABI.abi as any,
        functionName: 'nonces',
        args: [address],
        chainId: 31337,
      },
    ]) : [],
    query: {
      refetchInterval: 2000,
    }
  })

  // 3. Fetch L1 Balances (On Demand)
  const { data: l1Balances, isFetching: isLoadingL1, refetch: fetchL1 } = useQuery({
    queryKey: ['l1-balances', addresses, contractAddresses],
    queryFn: async () => {
      if (!l1Client || !contractAddresses) return null
      console.log('Fetching L1 balances...')
      return Promise.all(addresses.map(async (addr) => {
        const eth = await l1Client.getBalance({ address: addr })
        let token = 0n
        try {
            // Only fetch token if address is valid
            if (contractAddresses.PLASMA_TOKEN_ADDRESS !== '0x0000000000000000000000000000000000000000') {
                 token = await l1Client.readContract({
                    address: contractAddresses.PLASMA_TOKEN_ADDRESS as Address,
                    abi: PlasmaTokenABI.abi as any,
                    functionName: 'balanceOf',
                    args: [addr]
                }) as bigint
            }
        } catch (e) {
            console.warn('Failed to fetch L1 token balance', e)
        }
        return { eth, token }
      }))
    },
    enabled: false, // Disable auto-fetch
  })

  const handleShowL1 = () => {
    if (!showL1) {
        setShowL1(true)
        fetchL1()
    } else {
        setShowL1(false)
    }
  }

  const handleRefresh = () => {
    refetchL2Eth()
    refetchL2Contract()
    if (showL1) fetchL1()
  }

  const formatBalance = (val: bigint | undefined) => {
    if (val === undefined) return '-'
    return Number(formatEther(val)).toLocaleString('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    })
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent flex items-center gap-2">
          <Database className="w-6 h-6 text-blue-400" />
          Balance Monitor
        </h2>
        
        <div className="flex gap-3">
          <button 
            onClick={handleShowL1}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2",
              showL1 
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/50" 
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            )}
          >
            <Layers className="w-4 h-4" />
            {showL1 ? 'Hide L1 Info' : 'Show L1 Info'}
          </button>
          
          <button 
            onClick={handleRefresh}
            className="p-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-all"
            title="Refresh"
          >
            <RefreshCw className={cn("w-5 h-5", (isLoadingL1) && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="p-4 font-medium text-gray-400">Address</th>
                
                {/* L2 Columns */}
                <th className="p-4 font-medium text-blue-400">L2 ETH</th>
                <th className="p-4 font-medium text-blue-400">L2 PLASMA</th>
                <th className="p-4 font-medium text-blue-400">L2 Nonce</th>

                {/* L1 Columns (Conditional) */}
                {showL1 && (
                  <>
                    <th className="p-4 font-medium text-purple-400 border-l border-white/10">
                        <div className="flex items-center gap-2">
                            L1 ETH
                            {isLoadingL1 && <Loader2 className="w-3 h-3 animate-spin" />}
                        </div>
                    </th>
                    <th className="p-4 font-medium text-purple-400">L1 PLASMA</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {addresses.map((address, idx) => {
                // L2 Data
                const l2Eth = l2EthBalances?.[idx]
                const l2Token = l2ContractData?.[idx * 2]?.result as bigint
                const nonce = l2ContractData?.[idx * 2 + 1]?.result as bigint

                // L1 Data
                const l1Data = l1Balances?.[idx]

                // Check if this is the connected address
                const isConnectedAddress = connectedAddress?.toLowerCase() === address.toLowerCase()

                return (
                  <tr 
                    key={address} 
                    className={cn(
                      "transition-colors group",
                      isConnectedAddress 
                        ? "bg-gradient-to-r from-blue-500/20 to-purple-500/20 hover:from-blue-500/30 hover:to-purple-500/30 border-l-2 border-blue-400" 
                        : "hover:bg-white/5"
                    )}
                  >
                    <td className={cn("p-4 font-mono text-sm flex items-center gap-2", isConnectedAddress ? "text-blue-300 font-semibold" : "text-gray-300")}>
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs transition-colors",
                        isConnectedAddress 
                          ? "bg-blue-500/40 text-blue-300" 
                          : "bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-gray-400 group-hover:text-white"
                      )}>
                        {isConnectedAddress && <span className="text-lg">✓</span>}
                        {!isConnectedAddress && idx + 1}
                      </div>
                      <span className="opacity-70 group-hover:opacity-100 transition-opacity">
                        {address.slice(0, 6)}...{address.slice(-4)}
                        {isConnectedAddress && <span className="ml-2 text-xs text-blue-400">(You)</span>}
                      </span>
                    </td>

                    <td className={cn("p-4 font-mono text-sm", isConnectedAddress && "text-blue-300 font-semibold")}>
                      {formatBalance(l2Eth)}
                    </td>
                    <td className={cn("p-4 font-mono text-sm", isConnectedAddress && "text-blue-300 font-semibold")}>
                      {formatBalance(l2Token)}
                    </td>
                    <td className={cn("p-4 font-mono text-sm", isConnectedAddress ? "text-blue-300 font-semibold" : "text-gray-400")}>
                      {nonce !== undefined ? nonce.toString() : '-'}
                    </td>

                    {showL1 && (
                      <>
                        <td className={cn("p-4 font-mono text-sm border-l border-white/10", isConnectedAddress ? "text-blue-300 font-semibold" : "text-gray-400")}>
                          {isLoadingL1 && !l1Data ? '...' : formatBalance(l1Data?.eth)}
                        </td>
                        <td className={cn("p-4 font-mono text-sm", isConnectedAddress ? "text-blue-300 font-semibold" : "text-gray-400")}>
                          {isLoadingL1 && !l1Data ? '...' : formatBalance(l1Data?.token)}
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="text-center text-xs text-gray-500">
        L2 Auto-refresh: 2s • L1: On-demand
      </div>
    </div>
  )
}
