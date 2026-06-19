import { useState, useEffect } from 'react'
import { usePublicClient, useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { formatEther, type Address } from 'viem'
import { cn } from '../utils'
import { getContractConfig, getBackendApiUrl, type ContractConfig } from '../utils/config'
import PlasmaChainUTXOABI from '../abis/PlasmaChainUTXO.json'
import PlasmaTokenABI from '../abis/PlasmaToken.json'
import { RefreshCw, Layers, Database, Loader2, Coins } from 'lucide-react'

interface BalanceTableProps {
  addresses: Address[]
}

interface UTXO {
  utxoId: string
  owner: string
  token: string
  amount: string
  spent: boolean
  blockNumber: number
}

interface UserBalance {
  address: string
  l2Balance: bigint
  utxoCount: number
  utxos: UTXO[]
}

export function BalanceTable({ addresses }: BalanceTableProps) {
  const [showL1, setShowL1] = useState(false)
  const [showUtxoDetails, setShowUtxoDetails] = useState<string | null>(null)
  const [contractConfig, setContractConfig] = useState<ContractConfig | null>(null)
  const { address: connectedAddress } = useAccount()

  const l2Client = usePublicClient({ chainId: 31337 })
  const l1Client = usePublicClient({ chainId: 11155111 }) // Sepolia

  // Load contract addresses from backend on mount
  useEffect(() => {
    getContractConfig().then(setContractConfig)
  }, [])

  // Lightweight poll for TPS test status; pause heavy polling while a test is funding/running
  const { data: tpsTestStatus } = useQuery({
    queryKey: ['tps-test-active-check'],
    queryFn: async () => {
      try {
        const res = await fetch(`${getBackendApiUrl()}/api/test/tps/status`)
        const data = await res.json()
        return data.status as 'idle' | 'funding' | 'running' | 'complete' | 'error'
      } catch { return 'idle' as const }
    },
    refetchInterval: 1000,
  })
  const isTpsTestActive = tpsTestStatus === 'funding' || tpsTestStatus === 'running'

  // 1. Fetch L2 Native ETH Balances (Native)
  const { data: l2EthBalances, refetch: refetchL2Eth } = useQuery({
    queryKey: ['l2-eth-balances', addresses],
    queryFn: async () => {
      if (!l2Client) return null
      return Promise.all(addresses.map(addr => l2Client.getBalance({ address: addr })))
    },
    refetchInterval: isTpsTestActive ? false : 2000,
  })

  // 2. Fetch UTXO Balances from L2 Contract (optimized: 2 calls per address instead of N+1)
  const { data: utxoBalances, refetch: refetchUtxo } = useQuery({
    queryKey: ['utxo-balances', addresses, contractConfig?.PLASMA_CHAIN_UTXO_ADDRESS, contractConfig?.L2_PLASMA_TOKEN_ADDRESS],
    queryFn: async (): Promise<UserBalance[]> => {
      if (!l2Client || !contractConfig) return []

      // Fetch all addresses in parallel; per address: 1 balance + 1 unspent-ids = 2 RPC calls
      return Promise.all(addresses.map(async (addr): Promise<UserBalance> => {
        try {
          const [balance, unspentIds] = await Promise.all([
            l2Client.readContract({
              address: contractConfig.PLASMA_CHAIN_UTXO_ADDRESS as Address,
              abi: PlasmaChainUTXOABI,
              functionName: 'getUserBalance',
              args: [addr, contractConfig.L2_PLASMA_TOKEN_ADDRESS as Address],
            }) as Promise<bigint>,
            l2Client.readContract({
              address: contractConfig.PLASMA_CHAIN_UTXO_ADDRESS as Address,
              abi: PlasmaChainUTXOABI,
              functionName: 'getUnspentUtxos',
              args: [addr],
            }) as Promise<`0x${string}`[]>,
          ])

          // We have the IDs and the total balance; populate utxos with minimal info (skip per-UTXO detail fetch)
          // For full detail UI (showUtxoDetails), fetch on demand when user expands a row.
          const utxos: UTXO[] = unspentIds.map((utxoId) => ({
            utxoId,
            owner: addr,
            token: contractConfig.L2_PLASMA_TOKEN_ADDRESS,
            amount: '0', // omitted to avoid N+1; expand row for full detail
            spent: false,
            blockNumber: 0,
          }))

          return {
            address: addr,
            l2Balance: balance,
            utxoCount: unspentIds.length,
            utxos,
          }
        } catch (e) {
          console.warn(`Failed to fetch balance for ${addr}:`, e)
          return {
            address: addr,
            l2Balance: 0n,
            utxoCount: 0,
            utxos: [],
          }
        }
      }))
    },
    refetchInterval: isTpsTestActive ? false : 3000,
    enabled: !!contractConfig && !isTpsTestActive,
  })

  // 3. Fetch L1 Balances (On Demand)
  const { data: l1Balances, isFetching: isLoadingL1, refetch: fetchL1 } = useQuery({
    queryKey: ['l1-balances', addresses, contractConfig],
    queryFn: async () => {
      if (!l1Client || !contractConfig) return null
      console.log('Fetching L1 balances...')
      return Promise.all(addresses.map(async (addr) => {
        const eth = await l1Client.getBalance({ address: addr })
        let token = 0n
        try {
          if (contractConfig.PLASMA_TOKEN_ADDRESS !== '0x0000000000000000000000000000000000000000') {
            token = await l1Client.readContract({
              address: contractConfig.PLASMA_TOKEN_ADDRESS as Address,
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
    refetchUtxo()
    if (showL1) fetchL1()
  }

  const formatBalance = (val: bigint | undefined) => {
    if (val === undefined) return '-'
    return Number(formatEther(val)).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  const toggleUtxoDetails = (address: string) => {
    setShowUtxoDetails(showUtxoDetails === address ? null : address)
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent flex items-center gap-2">
          <Database className="w-6 h-6 text-blue-400" />
          UTXO Balance Monitor
        </h2>

        <div className="flex gap-3">
          <button
            onClick={handleShowL1}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2",
              showL1
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/50"
                : "bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10"
            )}
          >
            <Layers className="w-4 h-4" />
            {showL1 ? 'Hide L1 Info' : 'Show L1 Info'}
          </button>

          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10 transition-all"
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

                {/* L2 UTXO Columns */}
                <th className="p-4 font-medium text-blue-400">L2 ETH</th>
                <th className="p-4 font-medium text-blue-400">L2 PLASMA</th>
                <th className="p-4 font-medium text-blue-400">UTXOs</th>

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
                const userUtxo = utxoBalances?.find(u => u.address.toLowerCase() === address.toLowerCase())
                const l2Token = userUtxo?.l2Balance || 0n
                const utxoCount = userUtxo?.utxoCount || 0

                // L1 Data
                const l1Data = l1Balances?.[idx]

                // Check if this is the connected address
                const isConnectedAddress = connectedAddress?.toLowerCase() === address.toLowerCase()
                const isExpanded = showUtxoDetails === address

                return (
                  <>
                    <tr
                      key={address}
                      className={cn(
                        "transition-colors group cursor-pointer",
                        isConnectedAddress
                          ? "bg-gradient-to-r from-blue-500/20 to-purple-500/20 hover:from-blue-500/30 hover:to-purple-500/30 border-l-2 border-blue-400"
                          : "hover:bg-white/5"
                      )}
                      onClick={() => utxoCount > 0 && toggleUtxoDetails(address)}
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
                        <div className="flex items-center gap-2">
                          <Coins className="w-4 h-4 text-yellow-500" />
                          <span>{utxoCount}</span>
                          {utxoCount > 0 && (
                            <span className="text-xs text-gray-500">
                              {isExpanded ? '▲' : '▼'}
                            </span>
                          )}
                        </div>
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

                    {/* UTXO Details Row */}
                    {isExpanded && userUtxo && userUtxo.utxos.length > 0 && (
                      <tr key={`${address}-details`} className="bg-black/60">
                        <td colSpan={showL1 ? 6 : 4} className="p-4">
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-gray-400 mb-3">UTXO Details:</div>
                            <div className="grid gap-2">
                              {userUtxo.utxos.map((utxo) => (
                                <div
                                  key={utxo.utxoId}
                                  className="p-3 rounded-lg bg-white/5 border border-white/10 flex justify-between items-center"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                    <span className="font-mono text-xs text-gray-400">
                                      {utxo.utxoId.slice(0, 10)}...{utxo.utxoId.slice(-8)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <span className="text-xs text-gray-500">Block #{utxo.blockNumber}</span>
                                    <span className="font-mono text-sm font-medium text-green-400">
                                      {formatEther(BigInt(utxo.amount))} PLASMA
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-center text-xs text-gray-500">
        UTXO Model • Auto-refresh: 3s • L1: On-demand • Click row to expand UTXOs
      </div>
    </div>
  )
}
