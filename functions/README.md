# Plasma ECC - Utility Functions

Scripts utilitas untuk berinteraksi dengan Plasma ECC Layer 2.

## 📁 Available Scripts

### Legacy Scripts (JavaScript + ethers.js)

#### 1-get-tokens.js
Mint test tokens ke addresses yang ditentukan.

```bash
node functions/1-get-tokens.js
```

#### 2-test-deposit.js
Test deposit dari L1 (Sepolia) ke L2.

```bash
node functions/2-test-deposit.js
```

---

### New Scripts (TypeScript + Viem)

#### 3-check-l2-balance.ts
✨ **Simple balance checker untuk Layer 2**

Cek balance token di Layer 2 (PlasmaChain).

**Usage:**
```bash
# Check default test addresses
tsx functions/3-check-l2-balance.ts

# Check specific addresses
tsx functions/3-check-l2-balance.ts 0xAddress1 0xAddress2 0xAddress3
```

**Output:**
```
🔍 Checking Layer 2 Balances...

Configuration:
  L2 RPC URL: http://localhost:8545
  PlasmaChain: 0x94B75AA39bEC4cB15e7B9593C315aF203B7B847f
  PlasmaToken: 0xF6168876932289D073567f347121A267095f3DD6

📊 Balances:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Address                                      ETH                 PLASMA Token
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0xf39F...2266                                10000.0             1000.0
0x7099...79C8                                10000.0             500.0
0x3C44...293BC                               10000.0             250.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Balance check complete!
```

---

#### 4-check-balance-advanced.ts
✨ **Advanced balance checker dengan fitur lengkap**

Cek balance di L1 dan L2, dengan export ke JSON/CSV.

**Features:**
- ✅ Check balance di L1 (Sepolia) dan L2
- ✅ Show nonce dan transaction count
- ✅ Detailed view mode
- ✅ Export to JSON
- ✅ Export to CSV

**Usage:**
```bash
# Default view (table)
tsx functions/4-check-balance-advanced.ts

# Detailed view
tsx functions/4-check-balance-advanced.ts --detailed

# Check specific addresses
tsx functions/4-check-balance-advanced.ts 0xAddress1 0xAddress2

# Export to JSON
tsx functions/4-check-balance-advanced.ts --json

# Export to CSV
tsx functions/4-check-balance-advanced.ts --csv

# Combine flags
tsx functions/4-check-balance-advanced.ts 0xMyAddress --detailed --json --csv
```

**Output (Table View):**
```
🔍 Advanced Layer 2 Balance Checker

Configuration:
  L1 Network:   Sepolia
  L2 Network:   Plasma L2 (Local)

⏳ Fetching balances...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Address        L1 ETH    L1 PLASMA L2 ETH    L2 PLASMA Nonce
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0xf39F...2266  0.5       1000.0    10000.0   1000.0    5
0x7099...79C8  0.3       500.0     10000.0   500.0     2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Output (Detailed View):**
```
──────────────────────────────────────────────────────────────────────
📍 Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
──────────────────────────────────────────────────────────────────────

🔷 Layer 1 (Sepolia):
  ETH:          0.5000 ETH
  PLASMA Token: 1000.00 PLASMA

🔶 Layer 2 (Local):
  ETH:          10000.0000 ETH
  PLASMA Token: 1000.00 PLASMA

📊 Statistics:
  Nonce:        5
  TX Count:     12

💰 Summary:
  Total L1 Value: ~1000.50
  Total L2 Value: ~11000.00
```

**Export Formats:**

JSON output:
```json
{
  "timestamp": "2025-11-18T12:00:00.000Z",
  "l1Network": "Sepolia",
  "l2Network": "Plasma L2",
  "balances": [
    {
      "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "l1": {
        "eth": "0.5",
        "plasmaToken": "1000.0"
      },
      "l2": {
        "eth": "10000.0",
        "plasmaToken": "1000.0"
      },
      "nonce": 5,
      "txCount": 12
    }
  ]
}
```

---

#### 5-check-balance-api.ts
✨ **Query balances via Backend REST API**

Cek balance melalui backend API (paling mudah, tidak perlu setup client).

**Prerequisites:**
- Backend harus running (`cd backend && npm run dev`)

**Usage:**
```bash
# Check default addresses
tsx functions/5-check-balance-api.ts

# Check specific address
tsx functions/5-check-balance-api.ts 0xTokenAddress 0xUserAddress

# Show pending transactions
tsx functions/5-check-balance-api.ts --pending

# Multiple addresses with pending
tsx functions/5-check-balance-api.ts 0xToken 0xAddr1 0xAddr2 --pending
```

**Output:**
```
🔍 Check Balance via Backend API

⏳ Checking API connection...
✅ API is available at http://localhost:3001

Configuration:
  API URL:  http://localhost:3001
  Token:    0xF6168876932289D073567f347121A267095f3DD6
  Checking: 3 addresses

💰 Balances:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Address               Balance
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  0xf39F...2266                1000.0 PLASMA
  0x7099...79C8                 500.0 PLASMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Pending Transactions:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
From           To             Amount              Hash                Time
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0xf39F...2266  0x7099...79C8  50                  0x1234...5678       12:00:00
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Balance check complete!
```

---

#### 6-transfer-plasma-l2.ts
✨ **Transfer Plasma tokens di Layer 2**

Transfer token PLASMA dari satu address ke address lain di Layer 2.

**Usage:**
```bash
npx tsx 6-transfer-plasma-l2.ts <from_private_key> <to_address> <amount>
```

**Examples:**
```bash
# Transfer 100 PLASMA tokens dari account #0 ke address tertentu
npx tsx 6-transfer-plasma-l2.ts \
  0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0 \
  100

# Transfer 50 tokens dari account #1 ke account #2
npx tsx 6-transfer-plasma-l2.ts \
  0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
  50
```

**Anvil Default Accounts:**
- **Account #0**: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
  - Private Key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

- **Account #1**: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
  - Private Key: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`

- **Account #2**: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
  - Private Key: `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`

- **Account #3**: `0x90F79bf6EB2c4f870365E785982E1f101E93b906`
  - Private Key: `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6`

**Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💸 Plasma L2 Token Transfer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Configuration:
  L2 RPC:       http://localhost:8545
  PlasmaChain:  0x71550ac84Ba7599220eAEf5C756b847cB4486606
  PlasmaToken:  0x558785b76e29e5b9f8Bf428936480B49d71F3d76

Transfer Details:
  From:         0x90F79bf6EB2c4f870365E785982E1f101E93b906
  To:           0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0
  Amount:       100.0 PLASMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Checking balances before transfer...

Before Transfer:
  From balance: 1000.0 PLASMA
  To balance:   0.0 PLASMA

🔄 Executing transfer...

  Transaction hash: 0xabc123...
  Waiting for confirmation...

  ✅ Transfer confirmed!
  Block number: 42
  Gas used: 50000

📊 Checking balances after transfer...

After Transfer:
  From balance: 900.0 PLASMA (100.0 sent)
  To balance:   100.0 PLASMA (+100.0 received)

💰 Checking ERC20 token balances...

ERC20 Token Balances:
  From: 900.0 PLASMA
  To:   100.0 PLASMA

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Transfer completed successfully!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Features:**
- ✅ Balance check before transfer (prevent insufficient balance)
- ✅ Transfer execution dengan konfirmasi
- ✅ Balance check after transfer (verify success)
- ✅ ERC20 balance check (actual minted tokens)
- ✅ Detailed error messages dengan tips
- ✅ Support custom sender via private key

**Notes:**
- Transfer menggunakan PlasmaChain contract di L2
- Sender harus punya cukup PLASMA balance di PlasmaChain
- Sender juga perlu ETH untuk gas fees
- Bisa pilih account mana saja sebagai sender (via private key)
- Semua 4 Anvil default accounts bisa digunakan untuk testing

---

#### 7-check-transfer.ts
✨ **Check transfer transaction status**

Cek status transfer transactions di Layer 2, baik yang pending maupun yang sudah confirmed.

**Usage:**
```bash
# Check all pending and recent transfers
npx tsx 7-check-transfer.ts

# Check specific transaction hash
npx tsx 7-check-transfer.ts 0x1234567890abcdef...
```

**Examples:**
```bash
# Monitor all transfers
npx tsx 7-check-transfer.ts

# Check specific transaction status
npx tsx 7-check-transfer.ts 0xabc123def456...

# Auto-refresh every 10 seconds
watch -n 10 "npx tsx 7-check-transfer.ts"
```

**Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Plasma L2 Transfer Status Checker
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Configuration:
  L2 RPC:       http://localhost:8545
  Backend API:  http://localhost:3001
  PlasmaChain:  0x71550ac84Ba7599220eAEf5C756b847cB4486606
  PlasmaToken:  0x558785b76e29e5b9f8Bf428936480B49d71F3d76
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 PENDING TRANSACTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Transaction Hash: 0xabc123...
   From:      0xf39F...2266
   To:        0x7099...79C8
   Amount:    50.0 PLASMA
   Timestamp: 2025-11-19T10:30:00.000Z

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ RECENT CONFIRMED TRANSFERS (Last 100 blocks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Plasma TxHash: 0xdef456...
   From:         0xf39F...2266
   To:           0x7099...79C8
   Block:        42
   L2 Tx Hash:   0x789abc...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Pending:   1
  Confirmed: 5
  Total:     6
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Features:**
- ✅ Check all pending transactions from backend API
- ✅ Query recent confirmed transfers from L2 chain (last 100 blocks)
- ✅ Check specific transaction hash status
- ✅ Show transaction details (from, to, amount, timestamp)
- ✅ Works with or without backend API available
- ✅ Clear summary of pending vs confirmed transfers

**Notes:**
- Pending transactions require backend API to be running
- Confirmed transfers are fetched directly from L2 chain
- Shows last 100 blocks of confirmed transfers
- Can check specific transaction hash for detailed status

---

## 🚀 Quick Start

### 1. Install tsx (if not installed)

```bash
npm install -g tsx
```

### 2. Run a script

```bash
# Simple L2 balance check
tsx functions/3-check-l2-balance.ts

# Advanced with all features
tsx functions/4-check-balance-advanced.ts --detailed --json

# Via API (requires backend running)
tsx functions/5-check-balance-api.ts --pending
```

---

## 📋 Comparison

| Feature | Script 3 | Script 4 | Script 5 | Script 6 | Script 7 |
|---------|----------|----------|----------|----------|----------|
| **L2 Balance** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **L1 Balance** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **ETH Balance** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Transfer Tokens** | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Check Transfer Status** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Pending TXs** | ❌ | ❌ | ✅ | ❌ | ✅ |
| **Confirmed TXs** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Specific TX Hash** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Nonce/Stats** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Export JSON** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Export CSV** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Needs Backend** | ❌ | ❌ | ✅ | ❌ | Optional |
| **Write Operation** | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Complexity** | Simple | Advanced | API-based | Simple | Simple |
| **Speed** | Fast | Medium | Fast | Medium | Fast |

**Recommendations:**
- 🟢 **Script 3** - Quick L2 balance check
- 🟡 **Script 4** - Comprehensive analysis & export
- 🔵 **Script 5** - Easy check via API (if backend running)
- 🟣 **Script 6** - Transfer PLASMA tokens di L2
- 🔴 **Script 7** - Check transfer transaction status

---

## 🔧 Environment Variables

Required in `.env`:

```bash
# For Script 3 & 4
L2_RPC_URL=http://localhost:8545
L2_PLASMA_CHAIN_ADDRESS=0x94B75AA39bEC4cB15e7B9593C315aF203B7B847f
L2_PLASMA_TOKEN_ADDRESS=0xF6168876932289D073567f347121A267095f3DD6

# For Script 4 only (L1 checks)
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
PLASMA_TOKEN_ADDRESS=0x76eab394dbc12e34fa6418587bc7d7f9e339117c

# For Script 5 only (API)
API_BASE_URL=http://localhost:3001  # Optional, defaults to this
```

---

## 🐛 Troubleshooting

### "Cannot find module tsx"

```bash
npm install -g tsx
# or use npx
npx tsx functions/3-check-l2-balance.ts
```

### "Backend API is not available"

For script 5, make sure backend is running:

```bash
cd backend
npm run dev
```

### "Environment variable not found"

Check that `.env` file exists in project root:

```bash
ls -la ../.env
```

### "Connection refused"

Make sure L2 (Anvil) is running:

```bash
# Start Anvil in new terminal
anvil
```

---

## 💡 Tips

### 1. Quick Balance Check

```bash
# Create alias in ~/.bashrc or ~/.zshrc
alias check-l2="tsx functions/3-check-l2-balance.ts"

# Then just:
check-l2
```

### 2. Watch Mode

```bash
# Auto-refresh every 5 seconds
watch -n 5 "tsx functions/3-check-l2-balance.ts"
```

### 3. Pipe to File

```bash
# Save output
tsx functions/4-check-balance-advanced.ts > balances.txt

# Or use built-in export
tsx functions/4-check-balance-advanced.ts --json --csv
```

### 4. Check Multiple Addresses

```bash
# From file
cat addresses.txt | xargs tsx functions/3-check-l2-balance.ts
```

---

## 📚 Examples

### Example 1: Monitor Your Balance

```bash
# Check your balance every 10 seconds
watch -n 10 "tsx functions/3-check-l2-balance.ts 0xYourAddress"
```

### Example 2: Export All Balances

```bash
# Get all balances and export
tsx functions/4-check-balance-advanced.ts \
  0xAddr1 0xAddr2 0xAddr3 \
  --detailed --json --csv
```

### Example 3: Quick API Check

```bash
# Check via API with pending transactions
tsx functions/5-check-balance-api.ts --pending
```

---

## 🎯 Use Cases

### Development
- ✅ Quick balance verification
- ✅ Monitor test accounts
- ✅ Debug deposit/transfer flows

### Testing
- ✅ Verify state after transactions
- ✅ Check L1 ↔ L2 bridge
- ✅ Export data for analysis

### Production Monitoring
- ✅ Track user balances
- ✅ Generate reports (CSV/JSON)
- ✅ Audit trail

---

## 🔗 Related

- **Backend API:** `backend/README.md`
- **Documentation:** `DOKUMENTASI_PROJECT.md`
- **Quick Reference:** `backend/QUICK_REFERENCE.md`

---

**Last Updated:** 2025-11-18
**Version:** 1.0.0
