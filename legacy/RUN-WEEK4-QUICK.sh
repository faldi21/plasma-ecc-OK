#!/bin/bash

#
# Week 4 Quick Start Script
# Run this to start Week 4 UTXO stress testing immediately
#

echo "🚀 Starting Week 4 UTXO Stress Testing Framework"
echo ""
echo "Make sure Anvil is running on port 8545:"
echo "  anvil --port 8545"
echo ""
read -p "Press Enter to start Week 4 testing... or Ctrl+C to cancel"
echo ""

# Run Week 4 tests
bash testing/run-week4.sh "$@"
