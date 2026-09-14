#!/bin/bash
# Fix: Restart relay with fresh .env load

echo "🔄 Stopping relay service..."
pkill -f "tsx.*relay.ts" || true
pkill -f "npm run dev" || true
sleep 2

echo "🧹 Clearing Node.js module cache..."
rm -rf /home/faldi/plasma-ecc-OK/relay/node_modules/.cache 2>/dev/null || true

echo "✅ Relay stopped. Now run:"
echo ""
echo "  cd /home/faldi/plasma-ecc-OK/relay"
echo "  npm run dev"
echo ""
echo "After restart, check that L2 PlasmaChain address is correct:"
echo "  Expected: 0x2E983A1Ba5e8b38AAAeC4B440B9dDcFBf72E15d1"
