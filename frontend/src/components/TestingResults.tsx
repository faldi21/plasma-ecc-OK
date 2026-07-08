import { useEffect, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { AlertCircle, Check, Play, Square, Zap, Clock, Activity, RotateCw, Trash2, Download, Edit3, History } from 'lucide-react'
import { getBackendApiUrl } from '../utils/config'

// Safe number formatter — handles null/undefined/NaN from API gracefully
const fix = (v: number | null | undefined, digits = 2): string =>
  typeof v === 'number' && isFinite(v) ? v.toFixed(digits) : '0'

interface TpsStatus {
  status: 'idle' | 'funding' | 'running' | 'complete' | 'error'
  completedTx: number
  failedTx: number
  totalTx: number
  elapsedMs: number
  currentTps: number
  avgLatency: number
  recentLatencies: number[]
  errors: string[]
  result: TpsHistoryEntry | null
}

interface TpsHistoryEntry {
  id?: string
  label?: string
  config?: {
    totalTransactions: number
    concurrency: number
    amountPerTx: string
    mode?: 'ecc' | 'merkle'
  }
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

interface AveragedTpsHistoryEntry {
  totalTransactions: number
  tps: number
  avgLatency: number
  durationMs: number
}

const averageTpsHistoryByTotalTransactions = (
  history: TpsHistoryEntry[],
  mode: 'ecc' | 'merkle',
): AveragedTpsHistoryEntry[] => {
  const grouped = new Map<number, TpsHistoryEntry[]>()

  history
    .filter(r => (r.config?.mode ?? 'ecc') === mode)
    .forEach(r => {
      const totalTransactions = r.config?.totalTransactions ?? r.totalTransactions
      const runs = grouped.get(totalTransactions) ?? []
      runs.push(r)
      grouped.set(totalTransactions, runs)
    })

  return Array.from(grouped.entries())
    .map(([totalTransactions, runs]) => ({
      totalTransactions,
      tps: runs.reduce((sum, r) => sum + r.tps, 0) / runs.length,
      durationMs: runs.reduce((sum, r) => sum + r.durationMs, 0) / runs.length,
      avgLatency: runs.reduce((sum, r) => sum + r.avgLatency, 0) / runs.length,
    }))
    .sort((a, b) => a.totalTransactions - b.totalTransactions)
}

const INITIAL_STATUS: TpsStatus = {
  status: 'idle',
  completedTx: 0,
  failedTx: 0,
  totalTx: 0,
  elapsedMs: 0,
  currentTps: 0,
  avgLatency: 0,
  recentLatencies: [],
  errors: [],
  result: null,
}

function LiveTpsBenchmark({ onHistoryChange }: { onHistoryChange: () => void }) {
  const [totalTransactions, setTotalTransactions] = useState(50)
  const [concurrency, setConcurrency] = useState(3)
  const [amountPerTx, setAmountPerTx] = useState('0.01')
  const [batchSize, setBatchSize] = useState(1)
  const [createBlockEvery, setCreateBlockEvery] = useState(0)
  const [revertAfter, setRevertAfter] = useState(true)
  const [flushPendingChunkSize, setFlushPendingChunkSize] = useState(0)
  const [mode, setMode] = useState<'ecc' | 'merkle'>('ecc')
  const [tpsStatus, setTpsStatus] = useState<TpsStatus>(INITIAL_STATUS)
  const [startError, setStartError] = useState<string | null>(null)
  const pollingRef = useRef<number | null>(null)
  const prevStatusRef = useRef<TpsStatus['status']>('idle')

  const apiBase = getBackendApiUrl()

  useEffect(() => {
    if (prevStatusRef.current !== 'complete' && tpsStatus.status === 'complete') {
      onHistoryChange()
    }
    prevStatusRef.current = tpsStatus.status
  }, [tpsStatus.status, onHistoryChange])

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${apiBase}/api/test/tps/status`)
      const data = await res.json()
      if (data.success) {
        setTpsStatus({
          status: data.status,
          completedTx: data.completedTx,
          failedTx: data.failedTx,
          totalTx: data.totalTx,
          elapsedMs: data.elapsedMs,
          currentTps: data.currentTps,
          avgLatency: data.avgLatency,
          recentLatencies: data.recentLatencies || [],
          errors: data.errors || [],
          result: data.result,
        })
      }
    } catch (err) {
      console.error('Status poll error:', err)
    }
  }

  useEffect(() => {
    const isActive = tpsStatus.status === 'funding' || tpsStatus.status === 'running'
    if (isActive && pollingRef.current === null) {
      pollingRef.current = window.setInterval(fetchStatus, 500)
    }
    if (!isActive && pollingRef.current !== null) {
      window.clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    return () => {
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [tpsStatus.status])

  const handleStart = async () => {
    setStartError(null)
    setTpsStatus({ ...INITIAL_STATUS, status: 'funding', totalTx: totalTransactions })
    try {
      const res = await fetch(`${apiBase}/api/test/tps/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalTransactions, concurrency, amountPerTx, batchSize, createBlockEvery, revertAfter, flushPendingChunkSize, mode }),
      })
      const data = await res.json()
      if (!data.success) {
        setStartError(data.error || 'Failed to start test')
        setTpsStatus(INITIAL_STATUS)
        return
      }
      setTimeout(fetchStatus, 300)
    } catch (err: any) {
      setStartError(err.message || 'Network error')
      setTpsStatus(INITIAL_STATUS)
    }
  }

  const handleStop = async () => {
    try {
      await fetch(`${apiBase}/api/test/tps/stop`, { method: 'POST' })
    } catch (err) {
      console.error('Stop error:', err)
    }
  }

  const handleReset = () => {
    setTpsStatus(INITIAL_STATUS)
    setStartError(null)
  }

  const isIdle = tpsStatus.status === 'idle'
  const isFunding = tpsStatus.status === 'funding'
  const isRunning = tpsStatus.status === 'running'
  const isComplete = tpsStatus.status === 'complete'
  const isError = tpsStatus.status === 'error'
  const isActive = isFunding || isRunning

  const progressPercent = tpsStatus.totalTx > 0
    ? ((tpsStatus.completedTx + tpsStatus.failedTx) / tpsStatus.totalTx) * 100
    : 0

  const latencyChartData = tpsStatus.recentLatencies.map((latency, i) => ({
    idx: i + 1,
    latency,
  }))

  const result = tpsStatus.result

  const statusColor = {
    idle: 'bg-gray-500',
    funding: 'bg-yellow-500 animate-pulse',
    running: 'bg-green-500 animate-pulse',
    complete: 'bg-blue-500',
    error: 'bg-red-500',
  }[tpsStatus.status]

  return (
    <Card className="border-teal-400/20 bg-slate-950/75">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-6 h-6 text-purple-400" />
              Live TPS Benchmark
            </CardTitle>
            <CardDescription>
              Run real UTXO transfers on L2 Anvil using test accounts (A→B→C→A)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${statusColor}`} />
            <span className="text-sm font-medium capitalize">{tpsStatus.status}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Config Panel (idle/complete/error) */}
        {(isIdle || isComplete || isError) && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Total Transactions (sub-ops)</label>
                <input
                  type="number"
                  min={1}
                  max={50000}
                  value={totalTransactions}
                  onChange={(e) => setTotalTransactions(parseInt(e.target.value) || 1)}
                  disabled={isActive}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <input
                  type="range"
                  min={10}
                  max={5000}
                  step={10}
                  value={Math.min(totalTransactions, 5000)}
                  onChange={(e) => setTotalTransactions(parseInt(e.target.value))}
                  disabled={isActive}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Parallel Senders (max 3)</label>
                <select
                  value={concurrency}
                  onChange={(e) => setConcurrency(parseInt(e.target.value))}
                  disabled={isActive}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value={1}>1 (sequential)</option>
                  <option value={2}>2 (parallel)</option>
                  <option value={3}>3 (max parallel)</option>
                </select>
                <p className="text-xs text-gray-500">Capped by test account count</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Amount per Sub-op (ETH)</label>
                <input
                  type="text"
                  value={amountPerTx}
                  onChange={(e) => setAmountPerTx(e.target.value)}
                  disabled={isActive}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <p className="text-xs text-gray-500">Each sub-op transfers this amount</p>
              </div>
            </div>

            <div className="border-t border-slate-700/50 pt-4">
              <div className="mb-4 bg-slate-900/50 border border-slate-700 rounded-md p-3 flex items-center gap-3">
                <label className="text-xs text-gray-400 whitespace-nowrap">Accumulator (paper baseline):</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'ecc' | 'merkle')}
                  disabled={isActive}
                  className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="ecc">ECC Accumulator (paper proposal)</option>
                  <option value="merkle">Merkle Tree (baseline comparison)</option>
                </select>
                <span className={`text-xs px-2 py-0.5 rounded ${mode === 'ecc' ? 'bg-purple-900/40 text-purple-300' : 'bg-blue-900/40 text-blue-300'}`}>
                  {mode === 'ecc' ? 'PlasmaChainUTXO' : 'PlasmaChainUTXOMerkle'}
                </span>
              </div>
              <p className="text-xs font-semibold text-purple-300 mb-2 uppercase">Performance Tuning (Plasma-UTXO-ECC v2)</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-gray-400">Batch Size (sub-ops per tx)</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={batchSize}
                    onChange={(e) => setBatchSize(parseInt(e.target.value) || 1)}
                    disabled={isActive}
                    className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <p className="text-xs text-gray-500">
                    1 = legacy. {batchSize > 1 && <span className="text-purple-300">{batchSize} sub-ops bundled per tx (transferUtxoBatch)</span>}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-gray-400">Commit Block Every N sub-ops</label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={createBlockEvery}
                    onChange={(e) => setCreateBlockEvery(parseInt(e.target.value) || 0)}
                    disabled={isActive}
                    className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <p className="text-xs text-gray-500">
                    0 = never (defer accumulator entirely). Hot path stays fast.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                <div className="space-y-2">
                  <label className="text-xs text-gray-400 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={revertAfter}
                      onChange={(e) => setRevertAfter(e.target.checked)}
                      disabled={isActive}
                      className="rounded"
                    />
                    Revert Anvil State After Test
                  </label>
                  <p className="text-xs text-gray-500">
                    Auto-snapshot before test, evm_revert after. {revertAfter ? <span className="text-green-300">State clean tiap run</span> : <span className="text-yellow-300">State terus accumulate</span>}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-gray-400">Flush Pending (chunk size)</label>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={flushPendingChunkSize}
                    onChange={(e) => setFlushPendingChunkSize(parseInt(e.target.value) || 0)}
                    disabled={isActive}
                    className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <p className="text-xs text-gray-500">
                    Post-test: drain pendingUtxos via createBlockChunked (e.g. 50). 0 = skip.
                  </p>
                </div>
                <div className="flex flex-col justify-end gap-2">
                  {(isComplete || isError) && (
                    <button
                      onClick={handleReset}
                      className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded-md transition-colors flex items-center justify-center gap-2"
                    >
                      <RotateCw className="w-4 h-4" />
                      Reset
                    </button>
                  )}
                  <button
                    onClick={handleStart}
                    disabled={isActive}
                    className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-md transition-colors flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4" />
                    {isComplete || isError ? 'Run Again' : 'Start Benchmark'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {startError && (
          <div className="bg-red-950/40 border border-red-800 rounded-md p-3 text-sm text-red-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{startError}</span>
          </div>
        )}

        {/* Progress Panel (funding/running) */}
        {isActive && (
          <div className="space-y-4">
            <div className="bg-slate-800/50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">
                  {isFunding ? 'Funding test accounts via createDepositUtxo...' : 'Sending transfers...'}
                </span>
                <span className="font-semibold">
                  {tpsStatus.completedTx + tpsStatus.failedTx} / {tpsStatus.totalTx}
                </span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-teal-400 h-3 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                  <Zap className="w-3 h-3" /> Current TPS
                </div>
                <p className="text-2xl font-bold text-purple-300">{fix(tpsStatus.currentTps, 2)}</p>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                  <Check className="w-3 h-3" /> Completed
                </div>
                <p className="text-2xl font-bold text-green-400">{tpsStatus.completedTx}</p>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                  <AlertCircle className="w-3 h-3" /> Failed
                </div>
                <p className="text-2xl font-bold text-red-400">{tpsStatus.failedTx}</p>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                  <Clock className="w-3 h-3" /> Elapsed
                </div>
                <p className="text-2xl font-bold">{fix((tpsStatus.elapsedMs || 0) / 1000, 1)}s</p>
              </div>
            </div>

            {latencyChartData.length > 1 && (
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-400" />
                  Recent Batch Latency (ms)
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={latencyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="idx" stroke="rgba(255,255,255,0.5)" />
                    <YAxis stroke="rgba(255,255,255,0.5)" />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
                    <Line type="monotone" dataKey="latency" stroke="#a855f7" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <button
              onClick={handleStop}
              className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold py-2 px-4 rounded-md transition-colors flex items-center justify-center gap-2"
            >
              <Square className="w-4 h-4" />
              Stop Test
            </button>
          </div>
        )}

        {/* Result Panel */}
        {isComplete && result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg border border-purple-700/30 bg-purple-500/10 p-4">
                <p className="text-xs text-purple-300 mb-1">Final TPS</p>
                <p className="text-3xl font-bold text-purple-100">{fix(result.tps, 2)}</p>
              </div>
              <div className="rounded-lg border border-green-700/30 bg-green-500/10 p-4">
                <p className="text-xs text-green-300 mb-1">Success Rate</p>
                <p className="text-3xl font-bold text-green-100">
                  {result.totalTransactions > 0
                    ? ((result.successfulTransactions / result.totalTransactions) * 100).toFixed(1)
                    : 0}
                  %
                </p>
              </div>
              <div className="rounded-lg border border-blue-700/30 bg-blue-500/10 p-4">
                <p className="text-xs text-blue-300 mb-1">Duration</p>
                <p className="text-3xl font-bold text-blue-100">{fix((result.durationMs || 0) / 1000, 2)}s</p>
              </div>
              <div className="rounded-lg border border-slate-700/30 bg-slate-800/30 p-4">
                <p className="text-xs text-slate-300 mb-1">Total TX</p>
                <p className="text-3xl font-bold text-slate-100">{result.totalTransactions}</p>
                <p className="text-xs text-slate-400 mt-1">
                  ✓ {result.successfulTransactions} · ✗ {result.failedTransactions}
                </p>
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-sm font-medium mb-3">Latency Breakdown</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-400">Min</p>
                  <p className="text-xl font-bold text-green-400">{fix(result.minLatency, 0)}ms</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Avg</p>
                  <p className="text-xl font-bold text-yellow-400">{fix(result.avgLatency, 0)}ms</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Max</p>
                  <p className="text-xl font-bold text-red-400">{fix(result.maxLatency, 0)}ms</p>
                </div>
              </div>
            </div>

            {tpsStatus.errors.length > 0 && (
              <div className="bg-red-950/30 border border-red-800/50 rounded-lg p-4">
                <p className="text-sm font-medium text-red-300 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Recent Errors ({tpsStatus.errors.length} shown)
                </p>
                <div className="space-y-1 text-xs text-red-200 font-mono">
                  {tpsStatus.errors.map((err, i) => (
                    <p key={i} className="truncate">{err}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {isError && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-lg p-4">
            <p className="text-sm font-medium text-red-300 mb-2 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Test Failed
            </p>
            <div className="space-y-1 text-xs text-red-200 font-mono">
              {tpsStatus.errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ============ PAPER COMPARISON TABLES (Table 2, 3, 4 untuk paper IEEE) ============

interface AggregatedGas {
  mean: string   // bigint serialized
  std: string    // float as string
  min: string
  max: string
  runs: number
  samples: string[]
}

interface CalibrationResult {
  mode: 'ecc' | 'merkle'
  contractAddress: string
  deposit: AggregatedGas
  transfer: AggregatedGas
  withdrawal: AggregatedGas
  blockSubmission: AggregatedGas
  blockPendingTarget: number
  runs: number
  baseline: string
}

interface CalibrationData {
  timestamp: number
  runs: number
  blockPendingTarget: number
  ecc: CalibrationResult
  merkle: CalibrationResult
}

interface ProofSizeValidationResult {
  n: number
  merkleMeasured: number
  merkleTheoretical: number
  merkleMatch: boolean
  eccMeasured: number
  eccTheoretical: number
  eccMatch: boolean
  reductionPercent: number
  treeDepth: number
}

function PaperComparisonTables({ history }: { history: TpsHistoryEntry[] }) {
  const apiBase = getBackendApiUrl()
  const [calibration, setCalibration] = useState<CalibrationData | null>(null)
  const [calibrationLoading, setCalibrationLoading] = useState(false)
  const [calibrationError, setCalibrationError] = useState<string | null>(null)
  const [calibrationRuns, setCalibrationRuns] = useState(10)
  const [calibrationBlockN, setCalibrationBlockN] = useState(100)
  const [verifyGas, setVerifyGas] = useState<any>(null)
  const [verifyGasLoading, setVerifyGasLoading] = useState(false)
  const [verifyGasError, setVerifyGasError] = useState<string | null>(null)
  const [verifyRuns, setVerifyRuns] = useState(10)
  const [empirical, setEmpirical] = useState<{ results: ProofSizeValidationResult[]; timestamp: number } | null>(null)
  const [empiricalLoading, setEmpiricalLoading] = useState(false)

  // Load latest calibration on mount
  useEffect(() => {
    fetch(`${apiBase}/api/test/calibration/latest`)
      .then(r => r.json())
      .then(d => { if (d.success && d.data) setCalibration(d.data) })
      .catch(() => {})
  }, [])

  // Load latest verify-gas measurement on mount
  useEffect(() => {
    fetch(`${apiBase}/api/test/verify-gas/latest`)
      .then(r => r.json())
      .then(d => { if (d.success && d.data) setVerifyGas(d.data) })
      .catch(() => {})
  }, [])

  const runVerifyGas = async () => {
    setVerifyGasError(null); setVerifyGasLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/test/verify-gas/run?runs=${verifyRuns}`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) { setVerifyGasError(data.error || 'Verify-gas failed'); return }
      setVerifyGas(data.data)
    } catch (err: any) {
      setVerifyGasError(err.message || 'Network error')
    } finally {
      setVerifyGasLoading(false)
    }
  }

  // Auto-run empirical proof size validation on mount (cheap, deterministic)
  useEffect(() => {
    setEmpiricalLoading(true)
    fetch(`${apiBase}/api/test/proof-size-validation?ns=10,100,500,1000`)
      .then(r => r.json())
      .then(d => { if (d.success) setEmpirical(d.data) })
      .catch(() => {})
      .finally(() => setEmpiricalLoading(false))
  }, [])

  const reRunEmpirical = () => {
    setEmpiricalLoading(true)
    fetch(`${apiBase}/api/test/proof-size-validation?ns=10,100,500,1000`)
      .then(r => r.json())
      .then(d => { if (d.success) setEmpirical(d.data) })
      .catch(() => {})
      .finally(() => setEmpiricalLoading(false))
  }

  const runCalibration = async () => {
    setCalibrationError(null)
    setCalibrationLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/test/calibration/run?runs=${calibrationRuns}&blockPending=${calibrationBlockN}`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        setCalibrationError(data.error || 'Calibration failed')
        return
      }
      setCalibration(data.data)
    } catch (err: any) {
      setCalibrationError(err.message || 'Network error')
    } finally {
      setCalibrationLoading(false)
    }
  }

  // ===== TABLE 2: Proof Size (computed) =====
  const setSizes = [10, 100, 500, 1000]
  const proofSize = setSizes.map(n => {
    const merkleBytes = 32 * Math.ceil(Math.log2(n))
    const eccBytes = 64
    const reduction = ((merkleBytes - eccBytes) / merkleBytes) * 100
    return { n, merkleBytes, eccBytes, reduction }
  })

  // ===== TABLE 3: Gas Cost (measured, mean ± std) =====
  const fmtAggGas = (agg: AggregatedGas | undefined) => {
    if (!agg || !agg.mean || agg.mean === '0') return null
    const mean = Number(agg.mean)
    const std = Number(agg.std)
    if (!isFinite(mean) || mean === 0) return null
    return { meanStr: mean.toLocaleString(), stdStr: std.toLocaleString(undefined, { maximumFractionDigits: 0 }) }
  }
  const savings = (eccStr: string, merkleStr: string) => {
    const e = Number(eccStr), m = Number(merkleStr)
    if (!isFinite(e) || !isFinite(m) || e === 0 || m === 0) return '—'
    return `${(((e - m) / e) * 100).toFixed(1)}%`
  }

  // ===== TABLE 4: Throughput (averaged from all saved history, grouped by T) =====
  const eccRuns = averageTpsHistoryByTotalTransactions(history, 'ecc')
  const merkleRuns = averageTpsHistoryByTotalTransactions(history, 'merkle')

  // Export helpers (LaTeX format for paper)
  const exportTablesLatex = () => {
    let out = '% --- TABLE 2: Membership-Proof Size Comparison ---\n'
    out += '% Theoretical and empirically measured (build Merkle tree + generate proof).\n'
    out += '\\begin{tabular}{lcccc}\n\\toprule\nSet size $n$ & 10 & 100 & 500 & 1000 \\\\\n\\midrule\n'
    out += 'Merkle tree theoretical (bytes) & ' + proofSize.map(r => r.merkleBytes).join(' & ') + ' \\\\\n'
    if (empirical) {
      out += 'Merkle tree measured (bytes) & ' + empirical.results.map(r => r.merkleMeasured).join(' & ') + ' \\\\\n'
    }
    out += 'ECC accumulator theoretical (bytes) & ' + proofSize.map(r => r.eccBytes).join(' & ') + ' \\\\\n'
    if (empirical) {
      out += 'ECC accumulator measured (bytes) & ' + empirical.results.map(r => r.eccMeasured).join(' & ') + ' \\\\\n'
    }
    out += '\\midrule\nReduction (\\%) & ' + proofSize.map(r => r.reduction.toFixed(1)).join(' & ') + ' \\\\\n'
    out += '\\bottomrule\n\\end{tabular}\n\n'

    if (calibration) {
      out += `% --- TABLE 3: Gas Cost per Operation (mean ± std, N=${calibration.runs} runs, fixed n=${calibration.blockPendingTarget} for block submission) ---\n`
      out += '\\begin{tabular}{lrrr}\n\\toprule\nOperation & Merkle (gas) & ECC Acc. (gas) & Savings \\\\\n\\midrule\n'
      const aggFmt = (a: AggregatedGas) => `${Number(a.mean).toLocaleString('en-US').replace(/,/g, '{,}')} $\\pm$ ${Math.round(Number(a.std)).toLocaleString('en-US').replace(/,/g, '{,}')}`
      const rows = [
        { op: 'Deposit (L1$\\to$L2)', ecc: calibration.ecc.deposit, mer: calibration.merkle.deposit },
        { op: 'Transfer (L2)', ecc: calibration.ecc.transfer, mer: calibration.merkle.transfer },
        { op: 'Withdrawal (L2$\\to$L1)', ecc: calibration.ecc.withdrawal, mer: calibration.merkle.withdrawal },
        { op: `Block submission ($n{=}${calibration.blockPendingTarget}$)`, ecc: calibration.ecc.blockSubmission, mer: calibration.merkle.blockSubmission },
      ]
      for (const r of rows) {
        out += `${r.op} & ${aggFmt(r.mer)} & ${aggFmt(r.ecc)} & ${savings(r.ecc.mean, r.mer.mean)} \\\\\n`
      }
      out += '\\bottomrule\n\\end{tabular}\n\n'
      out += `% Baseline: ${calibration.ecc.baseline}\n`
      out += `% Measured: ${new Date(calibration.timestamp).toISOString()}\n`
    }

    const blob = new Blob([out], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `paper-tables-${Date.now()}.tex`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="border-indigo-400/20 bg-slate-950/75">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-400" />
              Paper Comparison Tables (Table 2-4)
            </CardTitle>
            <CardDescription>
              Data lengkap untuk membership-proof size, gas cost per operation, dan throughput comparison
            </CardDescription>
          </div>
          <button
            onClick={exportTablesLatex}
            disabled={!calibration && proofSize.length === 0}
            className="bg-indigo-700 hover:bg-indigo-600 disabled:bg-slate-700 text-sm px-3 py-1.5 rounded-md flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" />
            Export LaTeX
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* === Table 2 — Theoretical + Empirical === */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-indigo-300 uppercase">
              TABLE 2 — Membership-Proof Size Comparison (theoretical + empirical)
            </h4>
            <button
              onClick={reRunEmpirical}
              disabled={empiricalLoading}
              className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-xs px-3 py-1.5 rounded-md flex items-center gap-1"
            >
              <RotateCw className={`w-3 h-3 ${empiricalLoading ? 'animate-spin' : ''}`} />
              Re-run measurement
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="py-2 px-3 font-semibold text-xs text-gray-400">Set size n</th>
                  {setSizes.map(n => (
                    <th key={n} className="py-2 px-3 font-semibold text-xs text-gray-400 text-right">{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Merkle theoretical */}
                <tr className="border-b border-slate-800">
                  <td className="py-2 px-3 text-gray-300">Merkle <span className="text-gray-500 text-xs">(theoretical)</span></td>
                  {proofSize.map(r => (
                    <td key={r.n} className="py-2 px-3 text-right text-gray-300">{r.merkleBytes}</td>
                  ))}
                </tr>
                {/* Merkle measured */}
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-3 text-blue-300">Merkle <span className="text-blue-400 text-xs font-semibold">(measured)</span></td>
                  {setSizes.map(n => {
                    const m = empirical?.results.find(r => r.n === n)
                    const theoretical = proofSize.find(r => r.n === n)?.merkleBytes
                    return (
                      <td key={n} className="py-2 px-3 text-right">
                        {m ? (
                          <span className={m.merkleMeasured === theoretical ? 'text-blue-300 font-semibold' : 'text-yellow-400'}>
                            {m.merkleMeasured} {m.merkleMeasured === theoretical && <span className="text-green-400 ml-1">✓</span>}
                          </span>
                        ) : <span className="text-gray-600">—</span>}
                      </td>
                    )
                  })}
                </tr>
                {/* ECC theoretical */}
                <tr className="border-b border-slate-800">
                  <td className="py-2 px-3 text-gray-300">ECC <span className="text-gray-500 text-xs">(theoretical)</span></td>
                  {proofSize.map(r => (
                    <td key={r.n} className="py-2 px-3 text-right text-gray-300">{r.eccBytes}</td>
                  ))}
                </tr>
                {/* ECC measured */}
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-3 text-purple-300">ECC <span className="text-purple-400 text-xs font-semibold">(measured)</span></td>
                  {setSizes.map(n => {
                    const m = empirical?.results.find(r => r.n === n)
                    return (
                      <td key={n} className="py-2 px-3 text-right">
                        {m ? (
                          <span className={m.eccMeasured === 64 ? 'text-purple-300 font-semibold' : 'text-yellow-400'}>
                            {m.eccMeasured} {m.eccMeasured === 64 && <span className="text-green-400 ml-1">✓</span>}
                          </span>
                        ) : <span className="text-gray-600">—</span>}
                      </td>
                    )
                  })}
                </tr>
                <tr className="border-t-2 border-slate-700">
                  <td className="py-2 px-3 font-semibold">Reduction (%)</td>
                  {proofSize.map(r => (
                    <td key={r.n} className="py-2 px-3 text-right text-green-400 font-bold">{r.reduction.toFixed(1)}%</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            <span className="font-semibold text-gray-400">Theoretical</span>: Merkle = 32 × ⌈log₂(n)⌉ bytes (tight tree). ECC = 64 bytes constant (single EC point: x, y).
            {empirical && (
              <>
                {' '}
                <span className="font-semibold text-gray-400">Empirical</span>: built actual Merkle trees with random leaves, generated proof for leaf[0], serialized witness for ECC.
                Measured {new Date(empirical.timestamp).toLocaleString()}.
                {empirical.results.every(r => r.merkleMatch && r.eccMatch) && (
                  <span className="text-green-400 ml-1 font-semibold">All values match formulas ✓ (empirically validated)</span>
                )}
              </>
            )}
          </p>
        </div>

        {/* === Table 3 === */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-indigo-300 uppercase">
              TABLE 3 — Gas Cost per Operation
            </h4>
            <button
              onClick={runCalibration}
              disabled={calibrationLoading}
              className="bg-purple-700 hover:bg-purple-600 disabled:bg-slate-700 text-xs px-3 py-1.5 rounded-md flex items-center gap-1"
            >
              {calibrationLoading ? (
                <><RotateCw className="w-3 h-3 animate-spin" /> Running calibration...</>
              ) : (
                <><Play className="w-3 h-3" /> Run Calibration</>
              )}
            </button>
          </div>
          {/* Calibration config controls */}
          <div className="bg-slate-900/40 border border-slate-700 rounded-md p-3 mb-3 flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-gray-400">Runs (N):</span>
              <input
                type="number" min={1} max={50}
                value={calibrationRuns}
                onChange={(e) => setCalibrationRuns(parseInt(e.target.value) || 1)}
                disabled={calibrationLoading}
                className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-gray-400">Block pending (fixed n):</span>
              <input
                type="number" min={1} max={500}
                value={calibrationBlockN}
                onChange={(e) => setCalibrationBlockN(parseInt(e.target.value) || 1)}
                disabled={calibrationLoading}
                className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right"
              />
            </label>
            <span className="text-gray-500 text-xs">
              Total tx ≈ {calibrationRuns * 2 * (3 + calibrationBlockN + 4)} (both modes). Est. {(calibrationRuns * 2 * (3 + calibrationBlockN + 4) * 0.05).toFixed(0)}s
            </span>
          </div>
          {calibrationError && (
            <div className="bg-red-950/40 border border-red-800 rounded-md p-2 text-xs text-red-300 mb-2">
              {calibrationError}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="py-2 px-3 font-semibold text-xs text-gray-400">Operation</th>
                  <th className="py-2 px-3 font-semibold text-xs text-gray-400 text-right">Merkle (gas, mean ± std)</th>
                  <th className="py-2 px-3 font-semibold text-xs text-gray-400 text-right">ECC Acc. (gas, mean ± std)</th>
                  <th className="py-2 px-3 font-semibold text-xs text-gray-400 text-right">Savings</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { op: 'Deposit (L1→L2)', mer: calibration?.merkle.deposit, ecc: calibration?.ecc.deposit },
                  { op: 'Transfer (L2)', mer: calibration?.merkle.transfer, ecc: calibration?.ecc.transfer },
                  { op: 'Withdrawal (L2→L1)', mer: calibration?.merkle.withdrawal, ecc: calibration?.ecc.withdrawal },
                  { op: `Block submission (n=${calibration?.blockPendingTarget || calibrationBlockN} pending)`, mer: calibration?.merkle.blockSubmission, ecc: calibration?.ecc.blockSubmission },
                ].map(row => {
                  const mFmt = fmtAggGas(row.mer)
                  const eFmt = fmtAggGas(row.ecc)
                  return (
                    <tr key={row.op} className="border-b border-slate-800">
                      <td className="py-2 px-3 text-gray-300">{row.op}</td>
                      <td className="py-2 px-3 text-right">
                        {mFmt ? (
                          <span>
                            {mFmt.meanStr}
                            <span className="text-gray-500 ml-1">± {mFmt.stdStr}</span>
                          </span>
                        ) : <span className="text-gray-600">— (run calibration)</span>}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {eFmt ? (
                          <span>
                            {eFmt.meanStr}
                            <span className="text-gray-500 ml-1">± {eFmt.stdStr}</span>
                          </span>
                        ) : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="py-2 px-3 text-right text-green-400 font-semibold">
                        {row.ecc && row.mer ? savings(row.ecc.mean, row.mer.mean) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {calibration && (
            <div className="text-xs text-gray-500 mt-2 space-y-1">
              <p>
                Measured: {new Date(calibration.timestamp).toLocaleString()}.
                Calibration uses evm_snapshot/revert per measurement (isolated state).
                Block submission diukur dengan <b>n = {calibration.blockPendingTarget}</b> pending UTXOs (fixed).
              </p>
              <p>
                <b>N = {calibration.runs} runs</b> per operation. Std deviation in gas units. Min/max samples preserved in API response for reproducibility.
              </p>
              <p className="text-gray-600">
                Baseline: {calibration.ecc.baseline}
              </p>
            </div>
          )}
        </div>

        {/* === Table 3b — Isolated Verify-Step Gas === */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-indigo-300 uppercase">
              TABLE 3b — Isolated Verify-Step Gas (per witness check)
            </h4>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">Runs:</label>
              <input
                type="number" min={1} max={50}
                value={verifyRuns}
                onChange={(e) => setVerifyRuns(parseInt(e.target.value) || 1)}
                disabled={verifyGasLoading}
                className="w-14 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right text-xs"
              />
              <button
                onClick={runVerifyGas}
                disabled={verifyGasLoading}
                className="bg-purple-700 hover:bg-purple-600 disabled:bg-slate-700 text-xs px-3 py-1.5 rounded-md flex items-center gap-1"
              >
                {verifyGasLoading ? (
                  <><RotateCw className="w-3 h-3 animate-spin" /> Measuring...</>
                ) : (
                  <><Play className="w-3 h-3" /> Measure Verify Gas</>
                )}
              </button>
            </div>
          </div>
          {verifyGasError && (
            <div className="bg-red-950/40 border border-red-800 rounded-md p-2 text-xs text-red-300 mb-2">
              {verifyGasError}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="py-2 px-3 font-semibold text-xs text-gray-400">Operation</th>
                  <th className="py-2 px-3 font-semibold text-xs text-gray-400 text-right">Merkle (gas, mean ± std)</th>
                  <th className="py-2 px-3 font-semibold text-xs text-gray-400 text-right">ECC Acc. (gas, mean ± std)</th>
                  <th className="py-2 px-3 font-semibold text-xs text-gray-400 text-right">Ratio (ECC/Merkle)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-800">
                  <td className="py-2 px-3 text-gray-300">Witness verify (isolated)</td>
                  <td className="py-2 px-3 text-right">
                    {verifyGas?.merkle?.meanGas ? (
                      <span>
                        {Number(verifyGas.merkle.meanGas).toLocaleString()}
                        <span className="text-gray-500 ml-1">± {Math.round(Number(verifyGas.merkle.stdGas)).toLocaleString()}</span>
                      </span>
                    ) : <span className="text-gray-600">— (run measurement)</span>}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {verifyGas?.ecc?.meanGas ? (
                      <span>
                        {Number(verifyGas.ecc.meanGas).toLocaleString()}
                        <span className="text-gray-500 ml-1">± {Math.round(Number(verifyGas.ecc.stdGas)).toLocaleString()}</span>
                      </span>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="py-2 px-3 text-right text-yellow-300 font-semibold">
                    {verifyGas?.ecc?.meanGas && verifyGas?.merkle?.meanGas
                      ? `${(Number(verifyGas.ecc.meanGas) / Number(verifyGas.merkle.meanGas)).toFixed(1)}×`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {verifyGas && (
            <p className="text-xs text-gray-500 mt-2">
              N = <b>{verifyGas.runs} runs</b> per mode, evm_snapshot/revert per measurement.
              Merkle proof length = <b>{verifyGas.merkleProofLength}</b> hashes (matches on-chain tree depth).
              Random non-trivial inputs used (gas cost structurally independent of validity for fixed-shape cryptographic operations).
              Measured: {new Date(verifyGas.timestamp).toLocaleString()}.
            </p>
          )}
        </div>

        {/* === Table 4 === */}
        <div>
          <h4 className="text-sm font-semibold text-indigo-300 mb-2 uppercase">
            TABLE 4 — Throughput and Latency Comparison
          </h4>
          <p className="text-xs text-gray-500 mb-2">
            Average of all saved benchmark history, grouped by total transactions (T).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ECC */}
            <div>
              <p className="text-xs font-semibold text-purple-300 mb-1">ECC Accumulator</p>
              {eccRuns.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No ECC runs yet</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="py-1 px-2 text-left">T</th>
                      <th className="py-1 px-2 text-right">TPS</th>
                      <th className="py-1 px-2 text-right">Dur</th>
                      <th className="py-1 px-2 text-right">Lat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eccRuns.map(r => (
                      <tr key={r.totalTransactions} className="border-b border-slate-800">
                        <td className="py-1 px-2">{r.totalTransactions}</td>
                        <td className="py-1 px-2 text-right font-bold text-purple-300">{fix(r.tps, 0)}</td>
                        <td className="py-1 px-2 text-right">{fix((r.durationMs || 0) / 1000, 2)}s</td>
                        <td className="py-1 px-2 text-right">{fix(r.avgLatency, 0)}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {/* Merkle */}
            <div>
              <p className="text-xs font-semibold text-blue-300 mb-1">Merkle Baseline</p>
              {merkleRuns.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No Merkle runs yet — run benchmark dengan mode=Merkle</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="py-1 px-2 text-left">T</th>
                      <th className="py-1 px-2 text-right">TPS</th>
                      <th className="py-1 px-2 text-right">Dur</th>
                      <th className="py-1 px-2 text-right">Lat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {merkleRuns.map(r => (
                      <tr key={r.totalTransactions} className="border-b border-slate-800">
                        <td className="py-1 px-2">{r.totalTransactions}</td>
                        <td className="py-1 px-2 text-right font-bold text-blue-300">{fix(r.tps, 0)}</td>
                        <td className="py-1 px-2 text-right">{fix((r.durationMs || 0) / 1000, 2)}s</td>
                        <td className="py-1 px-2 text-right">{fix(r.avgLatency, 0)}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function TpsHistoryTable({ history, refreshing, onRefresh }: { history: TpsHistoryEntry[]; refreshing: boolean; onRefresh: () => void }) {
  const apiBase = getBackendApiUrl()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')

  const handleSaveLabel = async (id: string) => {
    try {
      await fetch(`${apiBase}/api/test/tps/history/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editLabel }),
      })
      setEditingId(null)
      onRefresh()
    } catch (err) {
      console.error('Save label error:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this result?')) return
    try {
      await fetch(`${apiBase}/api/test/tps/history/${id}`, { method: 'DELETE' })
      onRefresh()
    } catch (err) {
      console.error('Delete error:', err)
    }
  }

  const handleClearAll = async () => {
    if (!confirm(`Clear all ${history.length} results?`)) return
    try {
      await fetch(`${apiBase}/api/test/tps/history`, { method: 'DELETE' })
      onRefresh()
    } catch (err) {
      console.error('Clear error:', err)
    }
  }

  const handleExportCsv = () => {
    const headers = ['timestamp', 'label', 'totalTx', 'concurrency', 'amountPerTx', 'success', 'failed', 'tps', 'durationMs', 'avgLatency', 'minLatency', 'maxLatency']
    const rows = history.map(r => [
      new Date(r.timestamp).toISOString(),
      r.label || '',
      r.config?.totalTransactions ?? r.totalTransactions,
      r.config?.concurrency ?? '',
      r.config?.amountPerTx ?? '',
      r.successfulTransactions,
      r.failedTransactions,
      fix(r.tps, 4),
      r.durationMs ?? 0,
      fix(r.avgLatency, 2),
      fix(r.minLatency, 2),
      fix(r.maxLatency, 2),
    ].join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tps-history-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="bg-slate-900/50 border-slate-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-blue-400" />
              Benchmark History
            </CardTitle>
            <CardDescription>
              {history.length} run{history.length !== 1 ? 's' : ''} — persisted across sessions
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="bg-slate-700 hover:bg-slate-600 text-sm px-3 py-1.5 rounded-md flex items-center gap-1"
            >
              <RotateCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleExportCsv}
              disabled={history.length === 0}
              className="bg-blue-700 hover:bg-blue-600 disabled:bg-slate-800 disabled:cursor-not-allowed text-sm px-3 py-1.5 rounded-md flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              onClick={handleClearAll}
              disabled={history.length === 0}
              className="bg-red-900/50 hover:bg-red-800/60 disabled:bg-slate-800 disabled:cursor-not-allowed text-sm px-3 py-1.5 rounded-md flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No benchmark runs yet. Start a test to see results here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="py-2 px-2 font-semibold text-xs text-gray-400">When</th>
                  <th className="py-2 px-2 font-semibold text-xs text-gray-400">Label</th>
                  <th className="py-2 px-2 font-semibold text-xs text-gray-400 text-right">Tx</th>
                  <th className="py-2 px-2 font-semibold text-xs text-gray-400 text-right">Conc</th>
                  <th className="py-2 px-2 font-semibold text-xs text-gray-400 text-right">Amount</th>
                  <th className="py-2 px-2 font-semibold text-xs text-gray-400 text-right">Success</th>
                  <th className="py-2 px-2 font-semibold text-xs text-gray-400 text-right">TPS</th>
                  <th className="py-2 px-2 font-semibold text-xs text-gray-400 text-right">Duration</th>
                  <th className="py-2 px-2 font-semibold text-xs text-gray-400 text-right">Avg Lat</th>
                  <th className="py-2 px-2 font-semibold text-xs text-gray-400 text-right">Min/Max</th>
                  <th className="py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => {
                  const successPct = r.totalTransactions > 0 ? (r.successfulTransactions / r.totalTransactions) * 100 : 0
                  const isEditing = editingId === r.id
                  return (
                    <tr key={r.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                      <td className="py-2 px-2 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(r.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2 px-2">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <input
                              type="text"
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && r.id && handleSaveLabel(r.id)}
                              className="bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs w-32"
                              autoFocus
                            />
                            <button
                              onClick={() => r.id && handleSaveLabel(r.id)}
                              className="text-green-400 hover:text-green-300 text-xs"
                            >✓</button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-gray-400 hover:text-gray-300 text-xs"
                            >✗</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingId(r.id || null); setEditLabel(r.label || '') }}
                            className="text-left text-xs text-blue-300 hover:underline flex items-center gap-1 group"
                          >
                            {r.label || <span className="text-gray-500 italic">add label</span>}
                            <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">{r.config?.totalTransactions ?? r.totalTransactions}</td>
                      <td className="py-2 px-2 text-right">{r.config?.concurrency ?? '-'}</td>
                      <td className="py-2 px-2 text-right text-xs text-gray-400">{r.config?.amountPerTx ?? '-'}</td>
                      <td className="py-2 px-2 text-right">
                        <span className={successPct === 100 ? 'text-green-400' : successPct >= 80 ? 'text-yellow-400' : 'text-red-400'}>
                          {successPct.toFixed(0)}%
                        </span>
                        <span className="text-gray-500 text-xs ml-1">
                          ({r.successfulTransactions}/{r.totalTransactions})
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-bold text-purple-300">{fix(r.tps, 2)}</td>
                      <td className="py-2 px-2 text-right text-xs">{fix((r.durationMs || 0) / 1000, 2)}s</td>
                      <td className="py-2 px-2 text-right text-xs">{fix(r.avgLatency, 0)}ms</td>
                      <td className="py-2 px-2 text-right text-xs text-gray-400">
                        {fix(r.minLatency, 0)}/{fix(r.maxLatency, 0)}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <button
                          onClick={() => r.id && handleDelete(r.id)}
                          className="text-red-400 hover:text-red-300 opacity-50 hover:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function TestingResults() {
  const [history, setHistory] = useState<TpsHistoryEntry[]>([])
  const [historyRefreshing, setHistoryRefreshing] = useState(false)
  const apiBase = getBackendApiUrl()

  const fetchHistory = async () => {
    setHistoryRefreshing(true)
    try {
      const res = await fetch(`${apiBase}/api/test/tps/history`)
      const data = await res.json()
      if (data.success) setHistory(data.history || [])
    } catch (err) {
      console.error('Fetch history error:', err)
    } finally {
      setHistoryRefreshing(false)
    }
  }

  useEffect(() => { fetchHistory() }, [])

  return (
    <div className="w-full space-y-6">
      <div className="app-panel p-6">
        <p className="muted-label mb-2">Benchmark lab</p>
        <h2 className="text-3xl font-bold text-white">Testing Results</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Run live scalability benchmarks, generate paper comparison tables, and review persisted TPS history.
        </p>
      </div>

      {/* Live TPS Benchmark */}
      <LiveTpsBenchmark onHistoryChange={fetchHistory} />

      {/* Paper IEEE comparison tables (Table 2, 3, 4) */}
      <PaperComparisonTables history={history} />

      {/* Benchmark History */}
      <TpsHistoryTable history={history} refreshing={historyRefreshing} onRefresh={fetchHistory} />
    </div>
  )
}
