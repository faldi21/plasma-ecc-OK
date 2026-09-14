#!/bin/bash

# Week 5: Parallel UTXO Transfer Testing
# Tests concurrent UTXO transfers from 10 senders to 1 receiver
# - 10 senders × 10 transfers = 100 total operations
# - All transfers executed in parallel (concurrent load)
# - Measures throughput and latency under parallel stress

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

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                   WEEK 5 TESTING SUITE                       ║${NC}"
echo -e "${BLUE}║        Parallel UTXO Transfers (10 Senders × 10 TX)          ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

echo -e "\n${YELLOW}Configuration:${NC}"
echo "  Project Root: $PROJECT_ROOT"
echo "  Data Directory: $DATA_DIR"
echo "  Total Transfers: 100 (10 senders × 10 transfers)"
echo "  Execution: Parallel (concurrent)"

# Create data directory
mkdir -p "$DATA_DIR/benchmarks"

echo -e "\n${GREEN}🚀 Starting Week 5 Parallel UTXO Testing...${NC}\n"

# Run the test
cd "$PROJECT_ROOT"
npx tsx testing/scripts/week5-parallel-utxo-test.ts

echo -e "\n${GREEN}✅ Week 5 testing completed!${NC}"
echo "Results saved to: $DATA_DIR/benchmarks/"

# Display results summary
echo -e "\n${YELLOW}📊 Test Summary:${NC}"
if [ -f "$DATA_DIR/benchmarks/week5-parallel-utxo-"*.json ]; then
  LATEST_RESULT=$(ls -t "$DATA_DIR/benchmarks/week5-parallel-utxo-"*.json 2>/dev/null | head -1)
  if [ ! -z "$LATEST_RESULT" ]; then
    echo "Latest results: $(basename $LATEST_RESULT)"
    echo ""
    cat "$LATEST_RESULT" | jq '{
      testType,
      totalSenders,
      totalTransfers,
      successfulTransfers,
      failedTransfers,
      successRate: (.successRate | tostring + "%"),
      overallTps: (.overallTps | tostring + " TX/sec"),
      avgLatency: (.avgLatency | tostring + "ms"),
      totalTime: (.totalTime | tostring + "ms")
    }' 2>/dev/null || echo "Failed to parse results"
  fi
fi

echo -e "\n${GREEN}Week 5 testing suite complete!${NC}"
