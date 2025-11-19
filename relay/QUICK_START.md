# 🚀 Quick Start - Relay Service

Panduan cepat untuk menjalankan Plasma ECC Relay Service.

## Prerequisites

1. **L2 Local Anvil** harus running
2. **L2 Contracts** sudah deployed
3. **Backend API** sudah running
4. **Environment variables** sudah configured

## Step 1: Install Dependencies

```bash
cd relay
npm install
```

## Step 2: Verify Environment

Pastikan `.env` di project root (`/plasma-ecc-2/.env`) berisi:

```bash
# L1 (Sepolia)
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
SEPOLIA_WSS_URL=wss://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
ROOT_CHAIN_ADDRESS=0x...
PLASMA_TOKEN_ADDRESS=0x...
OPERATOR_PRIVATE_KEY=0x...

# L2 (Local)
L2_RPC_URL=http://localhost:8545
L2_PLASMA_CHAIN_ADDRESS=0x...
L2_PLASMA_TOKEN_ADDRESS=0x...
L2_OPERATOR_PRIVATE_KEY=0x...

# Backend API
L2_API_URL=http://localhost:3001
```

## Step 3: Start Services

### Terminal 1: Start Anvil

```bash
anvil
```

### Terminal 2: Deploy L2 Contracts (if not deployed)

```bash
cd script
node deploy-l2.js
```

Copy addresses yang dihasilkan ke `.env`:
- `L2_PLASMA_CHAIN_ADDRESS`
- `L2_PLASMA_TOKEN_ADDRESS`

### Terminal 3: Start Backend API

```bash
cd backend
npm run dev
```

Pastikan API running di `http://localhost:3001`.

### Terminal 4: Start Relay Service

```bash
cd relay
npm run dev
```

## Expected Output

```
🚀 Plasma ECC Relay Service - L1↔L2 Bridge
================================================
Function: Monitor L1 Deposits → Relay to L2 → Submit to L1
================================================
L1 Network:              Sepolia Testnet
L1 RootChain:            0x1234...
...

[L1 Monitor] Initialized
[L1 Monitor] Operator: 0x...
[L1 Monitor] Transport: WebSocket
[L2 Executor] Initialized
[L2 Executor] Operator: 0x...
[Block Submitter] Starting automatic submission

📊 Current State:
  Last L1 block:       0
  Processed tx count:  0
  Relayed deposits:    0

✅ Relay service is running!

Press Ctrl+C to stop gracefully
```

## Step 4: Test Deposit

Buat deposit di L1 menggunakan frontend atau script:

```bash
# Menggunakan functions script
cd functions
npx tsx 1-deposit-to-l1.ts
```

Atau menggunakan frontend:
```
http://localhost:3000
```

## Expected Relay Flow

Saat deposit terdeteksi:

```
═══════════════════════════════════════════════════════
🔔 New Deposit Event Detected
═══════════════════════════════════════════════════════
User:         0x742d35...
Token:        0x1234...
Amount:       1000000000000000000
Block:        7412345
Tx Hash:      0xabcdef...
───────────────────────────────────────────────────────
[Relay] 🔄 Relaying to L2...
[L2 Executor] Updating balance for 0x742d35...
  ✅ L2 updateBalance tx: 0x9876...
[L2 Executor] Minting tokens...
  ✅ L2 mint tx: 0x5432...
[Relay] ✅ Successfully relayed to L2
[Block Submitter] Added tx 0x9876... (1/10)
═══════════════════════════════════════════════════════
```

## Step 5: Verify Balance

Check balance di L2:

```bash
cd functions
npx tsx 3-check-l2-balance.ts
```

Output:
```
✅ Balance: 1000000000000000000 (1.0 tokens)
```

## Troubleshooting

### Issue: "Environment variable X is required"

**Solution:**
```bash
# Pastikan .env ada di project root
ls -la ../env

# Check isi .env
cat ../.env | grep SEPOLIA_RPC_URL
```

### Issue: "Failed to get accumulator value"

**Solution:**
```bash
# Pastikan backend running
curl http://localhost:3001/api/accumulator/value

# Restart backend jika perlu
cd backend
npm run dev
```

### Issue: "WebSocket connection failed"

**Solution:**
- Set `SEPOLIA_WSS_URL` di `.env`
- Atau relay akan fallback ke HTTP polling (slower tapi works)

### Issue: "Insufficient funds"

**Solution:**
- Pastikan operator wallet punya ETH di Sepolia
- Pastikan L2 operator wallet punya ETH di Anvil

### Issue: "Already processed" for all deposits

**Solution:**
```bash
# Reset state
rm .relay_state.json

# Restart relay
npm run dev
```

## Commands

```bash
# Development (auto-reload)
npm run dev

# Build for production
npm run build

# Production mode
npm start

# Clean build
rm -rf dist && npm run build
```

## Stopping the Service

Press `Ctrl+C` - relay akan gracefully shutdown dan submit pending transactions.

```
^C
SIGINT received

🛑 Stopping relay service...
📤 Submitting 3 pending transaction(s)...
✅ Relay service stopped
```

## Full System Check

Pastikan semua services running:

```bash
# Check Anvil
curl -X POST http://localhost:8545 -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Check Backend
curl http://localhost:3001/api/health

# Check Relay (view logs)
# Relay tidak punya HTTP endpoint, tapi logs akan menunjukkan statusnya
```

## Next Steps

1. **Monitor Logs**: Watch relay logs untuk errors
2. **Check State**: File `.relay_state.json` akan ter-create otomatis
3. **Make More Deposits**: Test dengan multiple deposits
4. **Watch Block Submission**: Setelah 10 deposits, block akan di-submit ke L1

---

**Ready to relay! 🚀**

Jika ada error, check troubleshooting section atau lihat `README.md` untuk detail lengkap.
