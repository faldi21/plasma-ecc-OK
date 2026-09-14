# Testing Framework for Plasma UTXO

Comprehensive benchmarking and analysis framework for PhD research on UTXO-based Plasma chain.

## Overview

This testing framework provides scientific-grade data collection for measuring performance, costs, and scalability of the Plasma UTXO system.

**Output:** JSON, CSV, Markdown reports, and PNG visualizations directly usable in dissertation chapters.

---

## Directory Structure

```
testing/
├── scripts/              # Benchmarking scripts
│   ├── types.ts         # Type definitions
│   ├── data-collector.ts # Data collection & storage
│   ├── utils.ts         # Helper utilities
│   ├── week1-deployment-benchmark.ts
│   ├── week1-transfer-benchmark.ts
│   ├── week2-performance-metrics.ts (coming)
│   ├── week3-load-test.ts (coming)
│   └── week4-analysis.ts (coming)
├── data/                # Benchmark data (auto-created)
│   └── research/
│       ├── benchmarks/  # Raw data (JSON, CSV)
│       ├── analysis/    # Reports (Markdown, JSON)
│       └── visualizations/ # Charts (PNG)
├── analysis/            # Analysis utilities (coming)
└── visualizations/      # Visualization utils (coming)
```

---

## Week 1: Deployment & Transfer Benchmarking

### What Gets Measured

**Deployment Costs:**
- RootChainUTXO (L1) gas usage
- PlasmaChainUTXO (L2) gas usage
- Execution time per deployment

**Transfer Metrics:**
- Gas per L2 transfer
- Latency (broadcast → confirmation)
- Throughput (TPS)
- State growth per transaction
- Success rate

### Data Collected

For each transaction:
```json
{
  "txIndex": 1,
  "txHash": "0x...",
  "txType": "transfer",
  "gasUsed": 85000,
  "gasPrice": 1000000000,
  "gasCost": 85000000000000,
  "submissionTime": 250,      // ms
  "blockTime": 150,           // ms
  "latency": 400,             // ms total
  "inputSize": 100,           // bytes
  "outputSize": 100,          // bytes
  "success": true
}
```

Aggregate metrics:
```json
{
  "totalTransactions": 100,
  "tps": 25.5,
  "avgLatency": 395,
  "p95Latency": 520,
  "p99Latency": 680,
  "totalGasUsed": "8500000",
  "avgGasPerTx": "85000",
  "successRate": 99.5
}
```

### Running Week 1 Tests

#### 1. Deployment Benchmark

Measure contract deployment gas costs:

```bash
cd /home/faldi/plasma-ecc-OK
npx ts-node testing/scripts/week1-deployment-benchmark.ts
```

**Output:**
- `data/research/benchmarks/deployment-YYYY-MM-DD.json`
- Console summary with gas breakdown

**Expected Duration:** 2-5 minutes

#### 2. Transfer Benchmark

Measure L2 transfer performance (10 transfers by default):

```bash
# Configure number of transfers (optional)
export TEST_TRANSFER_COUNT=10
export TEST_TRANSFER_AMOUNT=100

npx ts-node testing/scripts/week1-transfer-benchmark.ts
```

**Output:**
- `data/research/benchmarks/transactions-YYYY-MM-DD.json` (JSON)
- `data/research/benchmarks/transactions-YYYY-MM-DD.csv` (CSV for spreadsheet)
- `data/research/benchmarks/performance-YYYY-MM-DD.json`
- `data/research/analysis/week1-transfer-benchmark-YYYY-MM-DD.md` (Markdown report)

**Expected Duration:** 5-15 minutes depending on transfer count

---

## Output Formats

### 1. JSON Benchmarks
Raw transaction data, preserved for analysis:
```json
{
  "timestamp": "2026-01-20T10:30:00.000Z",
  "environment": "anvil",
  "transactionMetrics": [
    { "txIndex": 0, "gasUsed": "85000", ... },
    { "txIndex": 1, "gasUsed": "86000", ... }
  ]
}
```

### 2. CSV Spreadsheet
For easy import to Excel/Google Sheets:
```csv
txIndex,txHash,txType,gasUsed,gasPrice,gasCost,submissionTime(ms),latency(ms),success
0,0x123...,transfer,85000,1000000000,85000000000000,250,400,true
1,0x456...,transfer,86000,1000000000,86000000000000,245,395,true
```

### 3. Markdown Reports
Human-readable analysis with key findings:
```markdown
# transfer-benchmark - WEEK1

Environment: anvil
Timestamp: 2026-01-20T10:30:00.000Z

## Summary
- Tests Passed: 10/10
- Total Duration: 0.25 minutes
- Success Rate: 100.00%

## Key Findings
- Average gas per transfer: 85.50K
- Average latency: 397.50ms
- TPS achieved: 25.50
- Success rate: 100.00%
```

### 4. CSV Reports
Aggregated metrics in spreadsheet format:
```csv
metric,value,unit
TPS,25.50,tx/s
Avg Latency,397.50,ms
P95 Latency,520.00,ms
Avg Gas,85500,wei
Total Gas,8550000,wei
Success Rate,100.00,%
```

---

## Data Collection Tips

### For Consistency
1. **Warm up first:** Run 2-3 transfers before collecting data to stabilize
2. **Reset between tests:** Clear Anvil state: `anvil --fork-url <url>`
3. **Record environment:** Screenshot Anvil startup logs
4. **Note anomalies:** If a transfer is slow, record why

### For Accuracy
1. **Multiple runs:** Run each test 3+ times, use median values
2. **Monitor resources:** Check CPU/memory during tests
3. **Control variables:** Keep block time, gas price consistent
4. **Batch similar tests:** Run all transfers before block submissions

### For Dissertations
1. **Save raw data:** Keep all JSON files for reproducibility
2. **Document methodology:** Write how you ran each test
3. **Include uncertainties:** Report min/max alongside averages
4. **Cite data sources:** Reference the data files in your writing

---

## Integration with Dissertation

### Week 1 Data → Chapter on Performance

```markdown
## Performance Metrics (from Week 1 data)

Our testing framework measured the following on Anvil:

- **Throughput:** 25.50 TPS (Table 1)
- **Latency:** 397.50ms average, 520ms P95 (Figure 1)
- **Gas Costs:** 85,500 wei per transfer (Table 2)

Table 1: Performance Metrics
[From data/research/analysis/week1-transfer-benchmark.md]

Figure 1: Latency Distribution
[Generated from data/research/visualizations/latency-curve.png]
```

### How to Use Data Files

1. **JSON files:** Load into Python/R for statistical analysis
2. **CSV files:** Import into Excel for charts and pivot tables
3. **Markdown reports:** Copy directly into dissertation with minimal edits
4. **PNG charts:** Embed in dissertation as figures

---

## Coming Soon: Weeks 2-4

### Week 2: Performance Metrics
- TPS calculation methodology
- Latency percentiles (P50, P95, P99)
- State growth analysis
- Memory usage tracking

### Week 3: Load Testing
- Progressive load: 10 → 50 → 100 → 200 TPS
- Bottleneck identification
- Stability under load
- Failure modes

### Week 4: Analysis & Reporting
- Statistical analysis
- Visualization generation
- Dissertation chapter drafting
- Cross-phase comparisons

---

## Example: Running Full Week 1

```bash
# Setup
cd /home/faldi/plasma-ecc-OK
npm install  # if needed

# Run all Week 1 benchmarks
echo "Starting Week 1 benchmarking..."
echo ""

echo "1. Deployment costs..."
npx ts-node testing/scripts/week1-deployment-benchmark.ts
echo ""

echo "2. Transfer performance (100 transfers)..."
export TEST_TRANSFER_COUNT=100
npx ts-node testing/scripts/week1-transfer-benchmark.ts
echo ""

# Check what was collected
echo "Data collected:"
ls -lh data/research/benchmarks/
ls -lh data/research/analysis/
echo ""

echo "✅ Week 1 Complete!"
echo "Next: Analyze data in data/research/ for dissertation content"
```

---

## Troubleshooting

### "Transaction failed" errors
- Check Anvil is running: `curl http://localhost:8545 -X POST ...`
- Verify RPC URL in `.env`: `L2_RPC_URL=http://localhost:8545`
- Check account has balance

### Slow transfers
- Monitor Anvil CPU usage
- Reduce TEST_TRANSFER_COUNT
- Check system memory available

### Data not saving
- Verify `/data/` directory writable: `ls -la /data/`
- Check disk space: `df -h /`

---

## Research Workflow

```
Week 1: Collect baseline metrics (Anvil)
  ↓
Week 2: Deep performance analysis
  ↓
Week 3: Load testing to breaking point
  ↓
Week 4: Statistical analysis & reporting
  ↓
Phase 1 Complete: Anvil metrics ready
  ↓
Phase 2: Repeat on Geth L2 (multi-node)
  ↓
Phase 3-4: Server deployment & optimization
```

---

## Questions?

See: `/home/faldi/plasma-ecc-OK/PHASE-1-LAPTOP-DEVELOPMENT.md` for full research guide.
