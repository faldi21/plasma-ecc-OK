#!/bin/bash

# Week 5 Complete Setup Script
# Generates 10 addresses, funds them, deposits to Plasma, ready for testing

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              WEEK 5: COMPLETE SETUP (ALL-IN-ONE)              ║${NC}"
echo -e "${BLUE}║      Generate Keys → Fund → Deposit → Ready for Testing      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}\n"

echo -e "${YELLOW}Prerequisites:${NC}"
echo "✓ Anvil running on http://localhost:8545"
echo "✓ .env configured with L2_RPC_URL and PLASMA_CHAIN_UTXO_ADDRESS"
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
  echo -e "${RED}❌ .env file not found${NC}"
  echo "Please create .env with:"
  echo "  L2_RPC_URL=http://localhost:8545"
  echo "  PLASMA_CHAIN_UTXO_ADDRESS=0x2860763ac53e487b1521dfd6510f6780b2d86223"
  exit 1
fi

# Step 1: Generate keys
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}STEP 1: Generate 10 Private Keys & Addresses${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

npx tsx functions/generate-week5-keys.ts

# Step 2: Transfer ETH
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}STEP 2: Transfer 50 ETH to Each Address${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

npx tsx functions/week5-transfer-eth.ts

# Step 3: Deposit to Plasma
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}STEP 3: Deposit 100 ETH to Plasma (Create UTXOs)${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

npx tsx functions/week5-deposit-plasma.ts

# Verification
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}VERIFICATION: Check UTXO Status${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

npx tsx functions/check-week5-utxos.ts

# Final summary
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                  ✅ SETUP COMPLETE                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}\n"

echo -e "${GREEN}Week 5 is ready for testing!${NC}\n"

echo "Next steps:"
echo "  1. Run the test:"
echo -e "     ${YELLOW}./RUN-WEEK5-QUICK.sh${NC}"
echo ""
echo "  2. Check results:"
echo -e "     ${YELLOW}cat data/research/benchmarks/week5-parallel-utxo-*.json | jq .${NC}"
echo ""
echo "  3. Compare with previous weeks in TestingResults dashboard"
echo ""
