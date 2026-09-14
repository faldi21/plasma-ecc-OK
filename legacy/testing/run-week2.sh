#!/bin/bash

# Week 2: Advanced Benchmarking
# Load testing and state growth analysis

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║           WEEK 2: BENCHMARKING SUITE              ║"
echo "║   Plasma UTXO Testing Framework - Anvil           ║"
echo "║      Advanced Metrics & Load Testing              ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
echo "🔍 Checking prerequisites..."

if ! command -v npx &> /dev/null; then
    echo "❌ npx not found. Install Node.js first."
    exit 1
fi

if ! curl -s http://localhost:8545 > /dev/null; then
    echo "❌ Anvil not running on http://localhost:8545"
    echo "   Start Anvil: npx anvil"
    exit 1
fi

echo "✅ Prerequisites met"
echo ""

# Load environment
cd "$PROJECT_ROOT"
if [ -f .env ]; then
    set -a
    source .env
    set +a
    echo "✅ Environment loaded from .env"
else
    echo "⚠️  .env file not found, using system environment"
fi

# Create data directory
mkdir -p data/research/benchmarks
mkdir -p data/research/analysis
mkdir -p data/research/visualizations

echo "📁 Data directory: $(pwd)/data/research/"
echo ""

# Configure load test parameters
LOAD_TX_COUNT="${TEST_TRANSFER_COUNT:-20}"
LOAD_BATCHES="${TEST_LOAD_BATCHES:-3}"

# Configure state analysis parameters
STATE_ANALYSIS_START="${STATE_ANALYSIS_START_BLOCK:-0}"
STATE_ANALYSIS_END="${STATE_ANALYSIS_END_BLOCK:-9999}"
STATE_ANALYSIS_INTERVAL="${STATE_ANALYSIS_INTERVAL:-100}"

# Run benchmarks
echo "═══════════════════════════════════════════════════════"
echo "PHASE 1: LOAD TESTING"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "Configuration:"
echo "  TX per Batch: $LOAD_TX_COUNT"
echo "  Concurrent Batches: $LOAD_BATCHES"
echo "  Total TX: $((LOAD_TX_COUNT * LOAD_BATCHES))"
echo ""

export TEST_TRANSFER_COUNT="$LOAD_TX_COUNT"
export TEST_LOAD_BATCHES="$LOAD_BATCHES"

npx ts-node "$SCRIPT_DIR/scripts/week2-load-test-simple.ts" || {
    echo "⚠️  Load test encountered issues"
    # Continue to next test
}

echo ""
echo "═══════════════════════════════════════════════════════"
echo "PHASE 2: STATE ANALYSIS"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "Configuration:"
echo "  Block Range: $STATE_ANALYSIS_START - $STATE_ANALYSIS_END"
echo "  Sample Interval: $STATE_ANALYSIS_INTERVAL"
echo ""

export STATE_ANALYSIS_START_BLOCK="$STATE_ANALYSIS_START"
export STATE_ANALYSIS_END_BLOCK="$STATE_ANALYSIS_END"
export STATE_ANALYSIS_INTERVAL="$STATE_ANALYSIS_INTERVAL"

npx ts-node "$SCRIPT_DIR/scripts/week2-state-analysis.ts" || {
    echo "⚠️  State analysis encountered issues"
}

echo ""
echo "═══════════════════════════════════════════════════════"
echo "RESULTS SUMMARY"
echo "═══════════════════════════════════════════════════════"
echo ""

DATA_DIR="$(pwd)/data/research"

if [ -d "$DATA_DIR/benchmarks" ]; then
    echo "📊 Collected data:"
    ls -1 "$DATA_DIR/benchmarks/" | sed 's/^/   ✓ /'
    echo ""
fi

if [ -d "$DATA_DIR/analysis" ]; then
    echo "📝 Generated reports:"
    ls -1 "$DATA_DIR/analysis/" 2>/dev/null | sed 's/^/   ✓ /' || echo "   (generating...)"
    echo ""
fi

echo "📁 Full path: $DATA_DIR"
echo ""

# Print next steps
echo "╔════════════════════════════════════════════════════╗"
echo "║              NEXT STEPS                           ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "1. Review results:"
echo "   cat $DATA_DIR/analysis/*.md"
echo ""
echo "2. Compare Week 1 vs Week 2:"
echo "   # Check TPS, latency, gas differences"
echo "   cat $DATA_DIR/analysis/week1-*.md"
echo "   cat $DATA_DIR/analysis/week2-*.md"
echo ""
echo "3. Advanced analysis:"
echo "   # Load JSONs into Python/R for statistical comparison"
echo "   # Create graphs showing throughput/latency trends"
echo ""
echo "4. Next phase:"
echo "   bash testing/run-week3.sh  # (coming soon - stress testing)"
echo ""
echo "✨ Week 2 complete!"
echo ""
