#!/bin/bash

#
# Week 4: Real UTXO Stress Testing Framework
# Test Plasma UTXO transfers under progressive load
#
# Features:
# - Real UTXO transfers (not raw ETH)
# - Circular transfers between 3 users (A → B → C → A)
# - Progressive load escalation (50 → 100 → 200 → 500 transfers)
# - Detailed performance profiling
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_ROOT/data/research"

# Colors for output
BLUE='\\033[0;34m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
RED='\\033[0;31m'
NC='\\033[0m' # No Color

# Load environment variables
if [ -f "$PROJECT_ROOT/.env" ]; then
  set +a
  source "$PROJECT_ROOT/.env"
  set -a
else
  echo "⚠️  .env file not found at $PROJECT_ROOT/.env"
fi

# Display header
echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║         WEEK 4: REAL UTXO STRESS TESTING SUITE                            ║"
echo "║   Plasma UTXO Testing Framework - Real Token Transfer Load                ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Verify prerequisites
echo "🔍 Checking prerequisites..."

if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Please install Node.js"
  exit 1
fi

if ! command -v npm &> /dev/null; then
  echo "❌ npm not found. Please install npm"
  exit 1
fi

# Verify data directory exists
mkdir -p "$DATA_DIR/benchmarks"
mkdir -p "$DATA_DIR/analysis"

echo "✅ Prerequisites met"
echo ""

# Display configuration
echo "✅ Environment loaded from .env"
echo "📁 Data directory: $DATA_DIR"
echo ""

# Check if Anvil is running
if ! nc -z localhost 8545 2>/dev/null; then
  echo "⚠️  Warning: Anvil L2 not running on localhost:8545"
  echo "   Please start Anvil with: anvil --port 8545"
  echo ""
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Phase 1: UTXO Stress Testing
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "PHASE 1: REAL UTXO STRESS TESTING"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Testing with progressive UTXO transfer load:"
echo "  50 transfers (baseline) → 100 → 200 → 500 transfers (extreme)"
echo ""

if npx ts-node "$SCRIPT_DIR/scripts/week4-utxo-stress-test.ts"; then
  echo ""
  echo "✅ UTXO stress testing complete"
  echo ""
else
  echo ""
  echo "❌ UTXO stress testing failed"
  echo ""
  exit 1
fi

# Results summary
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "RESULTS SUMMARY"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

# List all generated files
echo "📊 Generated benchmark files:"
if ls "$DATA_DIR/benchmarks"/utxo-stress-*.json 1> /dev/null 2>&1; then
  ls -1 "$DATA_DIR/benchmarks"/utxo-stress-*.json | wc -l | xargs echo "   UTXO stress test files:"
fi

echo ""
echo "📁 Full path: $DATA_DIR"
echo ""

# Display next steps
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                        NEXT STEPS                                         ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "1. Review UTXO stress test results:"
echo "   cat $DATA_DIR/benchmarks/utxo-stress-summary-*.json | jq '.summary'"
echo ""
echo "2. View per-phase results:"
echo "   cat $DATA_DIR/benchmarks/utxo-stress-summary-*.json | jq '.phases[]'"
echo ""
echo "3. Compare with Week 3 (raw ETH) vs Week 4 (real UTXO):"
echo "   echo \"Week 3 ETH TPS: $(jq '.summary.maxTps' $DATA_DIR/benchmarks/stress-test-summary-*.json | head -1)\""
echo "   echo \"Week 4 UTXO TPS: $(jq '.summary.maxTps' $DATA_DIR/benchmarks/utxo-stress-summary-*.json | head -1)\""
echo ""
echo "4. For Python/R analysis:"
echo "   cp $DATA_DIR/benchmarks/utxo-stress-*.json /path/to/analysis/tools/"
echo ""

echo "✨ Week 4 UTXO stress testing complete!"
echo ""
