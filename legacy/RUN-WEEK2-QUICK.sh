#!/bin/bash

# Week 2: Quick Start Guide
# Run this to execute Week 2 load testing and state analysis

set -e

# Default configuration
DEFAULT_TX_COUNT=20
DEFAULT_BATCHES=3

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║        Week 2: Load Testing & State Analysis      ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
if ! curl -s http://localhost:8545 > /dev/null 2>&1; then
    echo "❌ Anvil not running!"
    echo "   Start it: npx anvil"
    exit 1
fi

echo "✅ Anvil is running"
echo ""

# Ask for configuration
read -p "Transfers per batch (default: $DEFAULT_TX_COUNT): " tx_count
tx_count=${tx_count:-$DEFAULT_TX_COUNT}

read -p "Number of batches (default: $DEFAULT_BATCHES): " batches
batches=${batches:-$DEFAULT_BATCHES}

total=$((tx_count * batches))
echo ""
echo "Configuration:"
echo "  TX per batch: $tx_count"
echo "  Batches: $batches"
echo "  Total TX: $total"
echo ""

# Run Week 2
echo "🚀 Running Week 2..."
echo ""

TEST_TRANSFER_COUNT=$tx_count TEST_LOAD_BATCHES=$batches bash testing/run-week2.sh

echo ""
echo "✨ Week 2 complete!"
echo ""
echo "View results:"
echo "  cat data/research/analysis/week2-*.json | jq"
echo "  ls -lah data/research/benchmarks/load-test-*.json"
echo ""
