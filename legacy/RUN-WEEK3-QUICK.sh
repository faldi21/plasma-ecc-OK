#!/bin/bash

#
# Week 3 Quick Start Script
# Run this to start Week 3 testing immediately
#

echo "🚀 Starting Week 3 Stress Testing Framework"
echo ""
echo "Make sure Anvil is running on port 8545:"
echo "  anvil --port 8545"
echo ""
read -p "Press Enter to start Week 3 testing... or Ctrl+C to cancel"
echo ""

# Run Week 3 tests
bash testing/run-week3.sh "$@"
