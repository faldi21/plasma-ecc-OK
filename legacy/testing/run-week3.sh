#!/bin/bash

#
# Week 3: Comprehensive Stress Testing Framework
# Tests extreme load scenarios, edge cases, and accumulator performance
#
# Features:
# - Progressive load escalation (100 → 2000 TX)
# - Edge case error condition testing
# - ECC accumulator stress testing
# - Detailed performance profiling
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_ROOT/data/research"

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

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
echo "║           WEEK 3: COMPREHENSIVE STRESS TESTING SUITE                      ║"
echo "║   Plasma UTXO Testing Framework - Extreme Load & Edge Cases               ║"
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

# Parse command line arguments
SKIP_PROGRESSIVE=false
SKIP_EDGE_CASES=false
SKIP_ACCUMULATOR=false
PHASES_ONLY=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-progressive)
      SKIP_PROGRESSIVE=true
      shift
      ;;
    --skip-edge-cases)
      SKIP_EDGE_CASES=true
      shift
      ;;
    --skip-accumulator)
      SKIP_ACCUMULATOR=true
      shift
      ;;
    --progressive-only)
      SKIP_EDGE_CASES=true
      SKIP_ACCUMULATOR=true
      shift
      ;;
    --edge-only)
      SKIP_PROGRESSIVE=true
      SKIP_ACCUMULATOR=true
      shift
      ;;
    --accumulator-only)
      SKIP_PROGRESSIVE=true
      SKIP_EDGE_CASES=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--skip-progressive] [--skip-edge-cases] [--skip-accumulator]"
      echo "       [--progressive-only] [--edge-only] [--accumulator-only]"
      exit 1
      ;;
  esac
done

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

# Phase 1: Progressive Load Testing
if [ "$SKIP_PROGRESSIVE" = false ]; then
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo "PHASE 1: PROGRESSIVE LOAD TESTING"
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo ""
  echo "Testing with progressive load escalation:"
  echo "  100 TX (baseline) → 250 TX → 500 TX → 1000 TX → 2000 TX (extreme)"
  echo ""

  # Export configuration for the script
  export WEEK3_STOP_ON_FAILURE="${WEEK3_STOP_ON_FAILURE:-true}"
  export WEEK3_FAILURE_THRESHOLD="${WEEK3_FAILURE_THRESHOLD:-25}"

  if npx ts-node "$SCRIPT_DIR/scripts/week3-stress-test.ts"; then
    echo ""
    echo "✅ Progressive load testing complete"
    echo ""
  else
    echo ""
    echo "❌ Progressive load testing failed"
    echo ""
    if [ "${WEEK3_STOP_ON_FAILURE:-true}" = "true" ]; then
      echo "Stopping due to errors"
      exit 1
    fi
  fi
else
  echo "⏭️  Skipping progressive load testing"
  echo ""
fi

# Phase 2: Edge Cases Testing
if [ "$SKIP_EDGE_CASES" = false ]; then
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo "PHASE 2: EDGE CASES & ERROR CONDITION TESTING"
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo ""
  echo "Testing error conditions:"
  echo "  • Insufficient balance"
  echo "  • Invalid addresses"
  echo "  • Large values"
  echo "  • Rapid nonce increments"
  echo "  • Zero value transfers"
  echo "  • Self transfers"
  echo ""

  if npx ts-node "$SCRIPT_DIR/scripts/week3-edge-cases.ts"; then
    echo ""
    echo "✅ Edge case testing complete"
    echo ""
  else
    echo ""
    echo "❌ Edge case testing failed"
    echo ""
  fi
else
  echo "⏭️  Skipping edge case testing"
  echo ""
fi

# Phase 3: Accumulator Stress Testing
if [ "$SKIP_ACCUMULATOR" = false ]; then
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo "PHASE 3: ECC ACCUMULATOR STRESS TESTING"
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo ""
  echo "Testing accumulator performance under load:"
  echo "  • Update time per transaction"
  echo "  • Memory footprint"
  echo "  • Consistency verification"
  echo ""

  # Export accumulator test configuration
  export WEEK3_ACCUMULATOR_TX_COUNT="${WEEK3_ACCUMULATOR_TX_COUNT:-500}"
  export WEEK3_SNAPSHOT_INTERVAL="${WEEK3_SNAPSHOT_INTERVAL:-50}"

  if npx ts-node "$SCRIPT_DIR/scripts/week3-accumulator-stress.ts"; then
    echo ""
    echo "✅ Accumulator stress testing complete"
    echo ""
  else
    echo ""
    echo "❌ Accumulator stress testing failed"
    echo ""
  fi
else
  echo "⏭️  Skipping accumulator stress testing"
  echo ""
fi

# Results summary
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "RESULTS SUMMARY"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

# List all generated files
echo "📊 Generated benchmark files:"
if ls "$DATA_DIR/benchmarks"/stress-test-*.json 1> /dev/null 2>&1; then
  ls -1 "$DATA_DIR/benchmarks"/stress-test-*.json | wc -l | xargs echo "   Stress test files:"
fi

if ls "$DATA_DIR/benchmarks"/edge-cases-*.json 1> /dev/null 2>&1; then
  ls -1 "$DATA_DIR/benchmarks"/edge-cases-*.json | wc -l | xargs echo "   Edge case files:"
fi

if ls "$DATA_DIR/benchmarks"/accumulator-stress-*.json 1> /dev/null 2>&1; then
  ls -1 "$DATA_DIR/benchmarks"/accumulator-stress-*.json | wc -l | xargs echo "   Accumulator test files:"
fi

echo ""
echo "📁 Full path: $DATA_DIR"
echo ""

# Display next steps
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                        NEXT STEPS                                         ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "1. Review stress test results:"
echo "   cat $DATA_DIR/benchmarks/stress-test-summary-*.json | jq '.summary'"
echo ""
echo "2. View edge case results:"
echo "   cat $DATA_DIR/benchmarks/edge-cases-*.json | jq '.results'"
echo ""
echo "3. Analyze accumulator performance:"
echo "   cat $DATA_DIR/benchmarks/accumulator-stress-*.json | jq '.statistics'"
echo ""
echo "4. Compare all three weeks:"
echo "   # Week 1 baseline TPS"
echo "   jq '.performanceMetrics.tps' $DATA_DIR/analysis/week1-transfer-benchmark-*.json"
echo "   # Week 2 load test TPS"
echo "   jq '.metrics.tps' $DATA_DIR/analysis/load-test-*.json"
echo "   # Week 3 progressive test (max TPS)"
echo "   jq '.summary.maxTps' $DATA_DIR/benchmarks/stress-test-summary-*.json"
echo ""
echo "5. For Python/R analysis:"
echo "   cp $DATA_DIR/benchmarks/*.json /path/to/analysis/tools/"
echo ""

echo "✨ Week 3 stress testing complete!"
echo ""
