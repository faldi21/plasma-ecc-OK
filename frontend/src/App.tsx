import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { config } from './config'
import { BalanceTable } from './components/BalanceTable'
import { TransferForm } from './components/TransferForm'
import { DepositForm } from './components/DepositForm'
import { type Address } from 'viem'
import { cn } from './utils'
import { LayoutDashboard, Send, Wallet, LogOut, ArrowDownCircle } from 'lucide-react'

const queryClient = new QueryClient()

// Default test addresses
const TEST_ADDRESSES: Address[] = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x62dc14Fe819A241e176ee6A813f51045d04A0cda',
  '0xba4BAe28e13cD93396c6A19880d3453E1d0F6c76',
  '0xfa5410ca7e30c694d332a0b7f5ff5ef74d84e0ab',
]

function Dashboard() {
  const [activeTab, setActiveTab] = useState<'balances' | 'transfer' | 'deposit'>('balances')
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center py-12">
      <div className="w-full max-w-6xl px-6 mb-8 flex items-end justify-between">
        <div>
            <h1 className="text-4xl font-bold tracking-tight mb-2">
            Plasma <span className="text-primary">ECC</span> Dashboard
            </h1>
            <p className="text-muted-foreground">
            Real-time Layer 2 balance monitoring and state verification.
            </p>
        </div>

        <div className="flex items-center gap-4">
            {isConnected ? (
                <div className="flex items-center gap-3 bg-secondary/50 p-1.5 pl-4 rounded-full border border-white/5">
                    <div className="text-sm font-mono text-gray-300">
                        {address?.slice(0, 6)}...{address?.slice(-4)}
                    </div>
                    <button 
                        onClick={() => disconnect()}
                        className="p-2 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                        title="Disconnect"
                    >
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            ) : (
                <button 
                    onClick={() => connect({ connector: injected() })}
                    className="px-6 py-2.5 rounded-full bg-primary text-primary-foreground font-medium hover:opacity-90 transition-all shadow-lg shadow-primary/20 flex items-center gap-2"
                >
                    <Wallet className="w-4 h-4" />
                    Connect Wallet
                </button>
            )}
        </div>
      </div>

      {/* Navigation */}
      <div className="w-full max-w-6xl px-6 mb-8">
        <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
            <button
                onClick={() => setActiveTab('balances')}
                className={cn(
                    "px-6 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                    activeTab === 'balances' 
                        ? "bg-primary text-primary-foreground shadow-lg" 
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
            >
                <LayoutDashboard className="w-4 h-4" />
                Balances
            </button>
            <button
                onClick={() => setActiveTab('transfer')}
                className={cn(
                    "px-6 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                    activeTab === 'transfer' 
                        ? "bg-green-500 text-white shadow-lg shadow-green-500/20" 
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
            >
                <Send className="w-4 h-4" />
                Transfer
            </button>
            <button
                onClick={() => setActiveTab('deposit')}
                className={cn(
                    "px-6 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                    activeTab === 'deposit' 
                        ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20" 
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
            >
                <ArrowDownCircle className="w-4 h-4" />
                Deposit L2
            </button>
        </div>
      </div>
      
      {activeTab === 'balances' ? (
        <BalanceTable addresses={TEST_ADDRESSES} />
      ) : activeTab === 'transfer' ? (
        <TransferForm />
      ) : (
        <DepositForm />
      )}
    </div>
  )
}

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
