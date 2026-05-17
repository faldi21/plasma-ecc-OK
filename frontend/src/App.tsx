import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { config } from './config'
import { BalanceTable } from './components/BalanceTable'
import { TransferForm } from './components/TransferForm'
import { DepositForm } from './components/DepositForm'
import { WithdrawForm } from './components/WithdrawForm'
import { TestingResults } from './components/TestingResults'
import { type Address } from 'viem'
import { cn } from './utils'
import { LayoutDashboard, Send, ArrowDownCircle, ArrowUpCircle, BarChart3 } from 'lucide-react'
import { ConnectButton } from '@rainbow-me/rainbowkit'

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
  const [activeTab, setActiveTab] = useState<'balances' | 'transfer' | 'deposit' | 'withdraw' | 'testing'>('balances')

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center py-12">
      <div className="w-full max-w-6xl px-6 mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">
            Plasma <span className="text-blue-400">ECC</span> <span className="text-yellow-400">UTXO</span>
          </h1>
          <p className="text-slate-400">
            Layer 2 Plasma with UTXO model and ECC Accumulator
          </p>
        </div>

        <div className="flex items-center gap-4">
          <ConnectButton />
        </div>
      </div>

      <div className="w-full max-w-6xl px-6 mb-8">
        <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
          <button
            onClick={() => setActiveTab('balances')}
            className={cn(
              "px-6 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
              activeTab === 'balances'
                ? "bg-blue-600 text-white shadow-lg"
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
                ? "bg-green-600 text-white shadow-lg"
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
                ? "bg-cyan-600 text-white shadow-lg"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            <ArrowDownCircle className="w-4 h-4" />
            Deposit
          </button>
          <button
            onClick={() => setActiveTab('withdraw')}
            className={cn(
              "px-6 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
              activeTab === 'withdraw'
                ? "bg-orange-600 text-white shadow-lg"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            <ArrowUpCircle className="w-4 h-4" />
            Withdraw
          </button>
          <button
            onClick={() => setActiveTab('testing')}
            className={cn(
              "px-6 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
              activeTab === 'testing'
                ? "bg-purple-600 text-white shadow-lg"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            <BarChart3 className="w-4 h-4" />
            Testing Results
          </button>
        </div>
      </div>

      {activeTab === 'balances' ? (
        <BalanceTable addresses={TEST_ADDRESSES} />
      ) : activeTab === 'transfer' ? (
        <TransferForm />
      ) : activeTab === 'deposit' ? (
        <DepositForm />
      ) : activeTab === 'withdraw' ? (
        <WithdrawForm />
      ) : (
        <TestingResults />
      )}
    </div>
  )
}

function AppContent() {
  return (
    <Dashboard />
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={config}>
        <RainbowKitProvider>
          <AppContent />
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  )
}

export default App
