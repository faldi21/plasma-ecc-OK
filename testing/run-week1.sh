#!/bin/bash

# Week 1: Deployment & Transfer Benchmarking
# This script runs all Week 1 benchmarks and collects data for the dissertation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║           WEEK 1: BENCHMARKING SUITE              ║"
echo "║     Plasma UTXO Testing Framework - Anvil         ║"
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

# Run benchmarks
echo "═══════════════════════════════════════════════════════"
echo "PHASE 1: DEPLOYMENT BENCHMARKING"
echo "═══════════════════════════════════════════════════════"
echo ""

npx ts-node "$SCRIPT_DIR/scripts/week1-deployment-benchmark.ts" || {
    echo "⚠️  Deployment benchmark encountered issues"
    # Continue to next test
}

echo ""
echo "═══════════════════════════════════════════════════════"
echo "PHASE 2: TRANSFER BENCHMARKING"
echo "═══════════════════════════════════════════════════════"
echo ""

# Configure transfer test
TRANSFER_COUNT="${TEST_TRANSFER_COUNT:-10}"
TRANSFER_AMOUNT="${TEST_TRANSFER_AMOUNT:-100}"

export TEST_TRANSFER_COUNT="$TRANSFER_COUNT"
export TEST_TRANSFER_AMOUNT="$TRANSFER_AMOUNT"

echo "Configuration:"
echo "  Transfer count: $TRANSFER_COUNT"
echo "  Amount per transfer: $TRANSFER_AMOUNT"
echo ""

npx ts-node "$SCRIPT_DIR/scripts/week1-transfer-benchmark.ts" || {
    echo "⚠️  Transfer benchmark encountered issues"
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
echo "2. Analyze data:"
echo "   - Open CSVs in Excel for charts"
echo "   - Load JSONs into Python/R for statistics"
echo ""
echo "3. Run advanced benchmarks:"
echo "   bash testing/run-week2.sh  # (coming soon)"
echo ""
echo "✨ Week 1 complete!"
echo ""
