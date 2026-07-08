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
import {
  Activity,
  ArrowDownCircle,
  ArrowRight,
  ArrowUpCircle,
  BarChart3,
  Cpu,
  LayoutDashboard,
  Network,
  Send,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { ConnectButton } from '@rainbow-me/rainbowkit'

const queryClient = new QueryClient()

type TabId = 'balances' | 'transfer' | 'deposit' | 'withdraw' | 'testing'

interface DashboardTab {
  id: TabId
  label: string
  title: string
  description: string
  icon: LucideIcon
  activeClass: string
  iconClass: string
}

const DASHBOARD_TABS: DashboardTab[] = [
  {
    id: 'balances',
    label: 'Balances',
    title: 'Balance Monitor',
    description: 'Pantau saldo L2, token PLASMA, dan UTXO aktif dari akun pengujian.',
    icon: LayoutDashboard,
    activeClass: 'border-cyan-400/60 bg-cyan-400/10 text-cyan-100 shadow-cyan-950/40',
    iconClass: 'text-cyan-300',
  },
  {
    id: 'transfer',
    label: 'Transfer',
    title: 'UTXO Transfer',
    description: 'Kirim token di Plasma L2 dengan pemilihan UTXO dan signature wallet.',
    icon: Send,
    activeClass: 'border-emerald-400/60 bg-emerald-400/10 text-emerald-100 shadow-emerald-950/40',
    iconClass: 'text-emerald-300',
  },
  {
    id: 'deposit',
    label: 'Deposit',
    title: 'Deposit to L2',
    description: 'Approve token di Sepolia lalu buat UTXO baru di Plasma L2.',
    icon: ArrowDownCircle,
    activeClass: 'border-blue-400/60 bg-blue-400/10 text-blue-100 shadow-blue-950/40',
    iconClass: 'text-blue-300',
  },
  {
    id: 'withdraw',
    label: 'Withdraw',
    title: 'Withdraw to L1',
    description: 'Mulai exit dari L2, lacak challenge period, lalu finalize di L1.',
    icon: ArrowUpCircle,
    activeClass: 'border-amber-400/60 bg-amber-400/10 text-amber-100 shadow-amber-950/40',
    iconClass: 'text-amber-300',
  },
  {
    id: 'testing',
    label: 'Testing Results',
    title: 'Testing and Results',
    description: 'Jalankan benchmark TPS, export data paper, dan lihat histori pengujian.',
    icon: BarChart3,
    activeClass: 'border-violet-400/60 bg-violet-400/10 text-violet-100 shadow-violet-950/40',
    iconClass: 'text-violet-300',
  },
]

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
  const [activeTab, setActiveTab] = useState<TabId>('balances')
  const activeTabData = DASHBOARD_TABS.find((tab) => tab.id === activeTab) ?? DASHBOARD_TABS[0]
  const ActiveIcon = activeTabData.icon

  return (
    <div className="min-h-screen overflow-x-hidden text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#080b13]/88 backdrop-blur-xl">
        <div className="app-container flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-teal-400/30 bg-teal-400/10">
              <ShieldCheck className="h-5 w-5 text-teal-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight text-white">
                Plasma ECC UTXO
              </h1>
              <p className="text-sm text-slate-400">
                Operational dashboard for Layer 2 UTXO transfers and benchmarking
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-2 text-xs text-slate-300">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-400/20 bg-blue-400/10 px-3 py-1.5">
                <Network className="h-3.5 w-3.5 text-blue-300" />
                Sepolia L1
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5">
                <Cpu className="h-3.5 w-3.5 text-emerald-300" />
                Plasma L2
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-1.5">
                <Activity className="h-3.5 w-3.5 text-amber-300" />
                ECC Accumulator
              </span>
            </div>
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="app-container space-y-6 py-6 sm:py-8">
        <section className="app-panel overflow-hidden">
          <div className="grid gap-6 p-5 md:grid-cols-[1fr_auto] md:p-6">
            <div className="flex items-start gap-4">
              <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]', activeTabData.iconClass)}>
                <ActiveIcon className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="muted-label mb-2">Current workspace</p>
                <h2 className="text-3xl font-bold leading-tight text-white">{activeTabData.title}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{activeTabData.description}</p>
              </div>
            </div>

            <div className="app-panel-soft flex min-w-[260px] items-center gap-3 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-400/10 text-blue-300">
                <Network className="h-4 w-4" />
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500" />
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-400/10 text-teal-300">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500" />
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">
                <Cpu className="h-4 w-4" />
              </div>
              <div className="ml-1">
                <p className="text-xs font-semibold text-slate-200">L1 to L2 flow</p>
                <p className="text-xs text-slate-500">Deposit, transfer, exit</p>
              </div>
            </div>
          </div>

          <nav className="grid grid-cols-2 gap-2 border-t border-white/10 bg-black/15 p-3 md:grid-cols-5" aria-label="Dashboard sections">
            {DASHBOARD_TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all focus-ring',
                    isActive
                      ? tab.activeClass
                      : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.06] hover:text-white'
                  )}
                >
                  <Icon className={cn('h-4 w-4', isActive ? tab.iconClass : 'text-slate-500')} />
                  <span className="truncate">{tab.label}</span>
                </button>
              )
            })}
          </nav>
        </section>

        <section>
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
        </section>
      </main>
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
