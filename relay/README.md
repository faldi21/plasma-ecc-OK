# Plasma ECC Relay Service

**TypeScript + Viem Implementation**

Service relay untuk menjembatani transaksi antara Layer 1 (Sepolia) dan Layer 2 (Anvil Local).

## 🎯 Fungsi Utama

1. **Monitor L1 Deposits**: Mendeteksi event `Deposit` dari RootChain di Sepolia
2. **Relay ke L2**: Mengeksekusi `updateBalance` dan `mint` di PlasmaChain L2
3. **Submit Blocks ke L1**: Mengirim batch transaksi kembali ke L1 dengan ECC Accumulator

## 📋 Flow Kerja

```
┌─────────────────────────────────────────────────────────────┐
│                    RELAY SERVICE FLOW                        │
└─────────────────────────────────────────────────────────────┘

1. User deposits → L1 RootChain (Sepolia)
                   ↓
2. Relay detects Deposit event
                   ↓
3. Relay calls L2 PlasmaChain.updateBalance()
                   ↓
4. Relay calls L2 PlasmaToken.mint()
                   ↓
5. Transaction added to pending batch
                   ↓
6. When batch full (10 tx) OR timeout (60s):
   - Get accumulator value from backend API
   - Submit block to L1 RootChain.submitBlock()
```

## 🏗️ Arsitektur

### Komponen Utama

```
relay/
├── src/
│   ├── types.ts          # Type definitions
│   ├── config.ts         # Environment configuration
│   ├── state.ts          # State persistence (.relay_state.json)
│   ├── l1-monitor.ts     # Monitor L1 Deposit events
│   ├── l2-executor.ts    # Execute transactions on L2
│   ├── block-submitter.ts # Batch & submit blocks to L1
│   └── relay.ts          # Main orchestrator
├── package.json
├── tsconfig.json
└── README.md
```

### L1 Monitor (`l1-monitor.ts`)

- Menggunakan **WebSocket** (preferred) atau HTTP polling (fallback)
- Auto-reconnect pada WebSocket disconnect
- Fetch historical events saat startup
- Watch real-time events

```typescript
const monitor = new L1Monitor(config);
await monitor.startMonitoring(fromBlock, async (deposit) => {
  // Handle deposit
});
```

### L2 Executor (`l2-executor.ts`)

- Update balance pada PlasmaChain L2
- Mint tokens pada PlasmaToken L2
- Wrapper function: `relayDeposit()`

```typescript
const executor = new L2Executor(config);
const result = await executor.relayDeposit(user, token, amount);
```

### Block Submitter (`block-submitter.ts`)

- Batch transaksi (default: 10 tx per block)
- Timeout submission (default: 60 detik)
- Fetch accumulator value dari backend API
- Submit ke L1 RootChain

```typescript
const submitter = new BlockSubmitter(config, l1Monitor);
submitter.start();
await submitter.addTransaction(txHash);
```

### State Manager (`state.ts`)

Menyimpan state persistent ke `.relay_state.json`:

```json
{
  "lastBlock": "7412345",
  "processed": ["0xabc...:0", "0xdef...:1"],
  "relayedDeposits": 42,
  "lastSubmittedBlock": 5
}
```

## 📦 Setup

### 1. Install Dependencies

```bash
cd relay
npm install
```

### 2. Environment Variables

Relay service membaca `.env` dari **project root** (`/plasma-ecc-2/.env`).

Required variables:

```bash
# L1 (Sepolia)
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
SEPOLIA_WSS_URL=wss://eth-sepolia.g.alchemy.com/v2/YOUR_KEY  # Optional, recommended
ROOT_CHAIN_ADDRESS=0x...
PLASMA_TOKEN_ADDRESS=0x...
OPERATOR_PRIVATE_KEY=0x...

# L2 (Local Anvil)
L2_RPC_URL=http://localhost:8545
L2_PLASMA_CHAIN_ADDRESS=0x...
L2_PLASMA_TOKEN_ADDRESS=0x...
L2_OPERATOR_PRIVATE_KEY=0x...

# Relay Settings
L1_FROM_BLOCK=0                    # Starting block (optional)
RELAY_TRANSACTIONS_PER_BLOCK=10    # Batch size (optional)
RELAY_BLOCK_TIMEOUT=60000          # Timeout ms (optional)

# Backend API
L2_API_URL=http://localhost:3001   # For accumulator value (optional)
```

### 3. Build (Production)

```bash
npm run build
```

### 4. Run

**Development (auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

## 🔧 Usage

### Development Mode

```bash
cd relay
npm run dev
```

Output:
```
🚀 Plasma ECC Relay Service - L1↔L2 Bridge
================================================
Function: Monitor L1 Deposits → Relay to L2 → Submit to L1
================================================
L1 Network:              Sepolia Testnet
L1 RootChain:            0x1234...
L1 PlasmaToken:          0x5678...
L1 RPC:                  https://eth-sepolia.g.alchemy.com/v2/...

L2 Network:              Local Anvil
L2 PlasmaChain:          0xabcd...
L2 PlasmaToken:          0xef01...
L2 RPC:                  http://localhost:8545

Relay Settings:
  Block Submission:      Every 10 transactions
  Timeout:               60 seconds
  Starting from block:   0
================================================

[State] No existing state file, creating new...
[L1 Monitor] Initialized
[L1 Monitor] Operator: 0x...
[L1 Monitor] Transport: WebSocket
[L2 Executor] Initialized
[L2 Executor] Operator: 0x...
[Block Submitter] Starting automatic submission
  Trigger: 10 transactions
  Timeout: 60 seconds

📊 Current State:
  Last L1 block:       0
  Processed tx count:  0
  Relayed deposits:    0

🚀 Starting relay service...

[L1 Monitor] Starting from block 0
[L1 Monitor] Using WebSocket event watching
[L1 Monitor] Found 0 historical deposits
[L1 Monitor] ✅ WebSocket watching active
✅ Relay service is running!

Press Ctrl+C to stop gracefully
```

### When Deposit Detected

```
═══════════════════════════════════════════════════════
🔔 New Deposit Event Detected
═══════════════════════════════════════════════════════
User:         0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0
Token:        0x1234567890123456789012345678901234567890
Amount:       1000000000000000000
Block:        7412345
Tx Hash:      0xabcdef...
Log Index:    2
───────────────────────────────────────────────────────
[Relay] 🔄 Relaying to L2...
[L2 Executor] Updating balance for 0x742d35...
  Token L1: 0x1234...
  Token L2: 0x5678...
  Amount:   1000000000000000000
  ✅ L2 updateBalance tx: 0x9876...
[L2 Executor] Minting 1000000000000000000 tokens to 0x742d35...
  ✅ L2 mint tx: 0x5432...
[Relay] ✅ Successfully relayed to L2
  updateBalance tx: 0x9876...
  mint tx:          0x5432...
[Block Submitter] Added tx 0x9876... (1/10)
═══════════════════════════════════════════════════════
```

### When Block Submitted

```
[Block Submitter] Submitting block 1 with 10 transactions
  Transactions: 10
  Accumulator X: 0x1a2b3c...
  Accumulator Y: 0x4d5e6f...
[L1 Monitor] Submitting block 1 to L1
  ✅ L1 submitBlock tx: 0xfedcba...
[Block Submitter] ✅ Block 1 submitted: 0xfedcba...
```

## 🛑 Graceful Shutdown

Press `Ctrl+C` untuk stop dengan graceful:

```
^C
SIGINT received

🛑 Stopping relay service...

📤 Submitting 3 pending transaction(s)...
[Block Submitter] Force submitting current batch
[Block Submitter] Submitting block 5 with 3 transactions
  ✅ L1 submitBlock tx: 0x...

✅ Relay service stopped
```

State akan disimpan otomatis, sehingga saat restart akan lanjut dari block terakhir.

## 📊 State Persistence

File `.relay_state.json` di project root menyimpan:

```json
{
  "lastBlock": "7412345",
  "processed": [
    "0xabc123:0",
    "0xdef456:1"
  ],
  "relayedDeposits": 42,
  "lastSubmittedBlock": 5
}
```

- `lastBlock`: Block terakhir yang diproses dari L1
- `processed`: Array of `txHash:logIndex` yang sudah diproses (max 2000 entries)
- `relayedDeposits`: Total deposits yang sudah di-relay
- `lastSubmittedBlock`: Block number terakhir yang di-submit ke L1

## 🔍 Monitoring

### Check Status via Code

```typescript
import RelayService from './src/relay.js';

const relay = new RelayService();
const status = relay.getStatus();

console.log('Running:', status.isRunning);
console.log('Last Block:', status.state.lastBlock);
console.log('Pending TX:', status.submitter.pendingTxCount);
```

### Log Levels

- `[L1 Monitor]` - Events dari L1 monitoring
- `[L2 Executor]` - Eksekusi transaksi di L2
- `[Block Submitter]` - Batch & submission ke L1
- `[State]` - State management
- `[Relay]` - Main orchestrator

## 🚨 Error Handling

### WebSocket Disconnect

Auto-reconnect dengan 10 attempts, 5 detik delay antar retry.

### Failed Relay to L2

Error logged, deposit **tidak** di-mark processed, akan retry saat service restart.

### Failed Block Submission

Pending transactions **tidak** di-clear, akan retry setelah timeout.

### Backend API Down

Jika backend API (accumulator value) tidak tersedia, block submission akan di-skip dan retry.

## 🔧 Configuration

### Transaction Batch Size

```bash
RELAY_TRANSACTIONS_PER_BLOCK=10  # Default: 10
```

Semakin besar = lebih hemat gas L1, tapi lebih lama tunggu.

### Timeout Submission

```bash
RELAY_BLOCK_TIMEOUT=60000  # Default: 60 detik
```

Jika batch belum penuh, akan submit otomatis setelah timeout.

### Starting Block

```bash
L1_FROM_BLOCK=7412000  # Default: 0
```

Mulai monitoring dari block tertentu (useful saat re-sync).

## 🧪 Testing

### Manual Testing Flow

1. **Start L2 Local Anvil:**
   ```bash
   anvil
   ```

2. **Deploy L2 Contracts:**
   ```bash
   cd script
   node deploy-l2.js
   ```

3. **Start Backend API:**
   ```bash
   cd backend
   npm run dev
   ```

4. **Start Relay Service:**
   ```bash
   cd relay
   npm run dev
   ```

5. **Make Deposit on L1:**
   ```bash
   # Use frontend or ethers.js script
   # Example: functions/1-deposit-to-l1.ts
   ```

6. **Watch Logs:**
   - Relay detects deposit
   - Relays to L2
   - Submits block to L1

## 📚 API Integration

### Get Accumulator Value

Relay service calls backend API:

```
GET http://localhost:3001/api/accumulator/value
```

Response:
```json
{
  "success": true,
  "accumulator": {
    "x": "0x1a2b3c...",
    "y": "0x4d5e6f..."
  }
}
```

### Get Pending Transactions

```
GET http://localhost:3001/api/pending
```

Response:
```json
{
  "success": true,
  "count": 5,
  "transactions": [
    {
      "txHash": "0xabc...",
      "from": "0x123...",
      "to": "0x456...",
      "amount": "1000000000000000000",
      "timestamp": "2025-01-20T10:30:00Z"
    }
  ]
}
```

## 🎓 Technical Details

### Viem Features Used

- `createPublicClient` - Read blockchain data
- `createWalletClient` - Send transactions
- `watchContractEvent` - Real-time event watching
- `getLogs` - Historical event fetching
- `writeContract` - Contract function calls
- `waitForTransactionReceipt` - Wait for confirmation

### WebSocket vs HTTP

**WebSocket (Preferred):**
- Real-time events
- Lower latency
- Auto-reconnect

**HTTP Polling (Fallback):**
- 30 detik polling interval
- More reliable for some providers
- Higher latency

### Atomic State Writes

State file ditulis secara atomic:
1. Write ke `.relay_state.json.tmp`
2. Rename ke `.relay_state.json`

Ini mencegah corrupted state saat crash.

## 🐛 Troubleshooting

### "WebSocket connection failed"

Solution: Set `SEPOLIA_WSS_URL` atau relay akan fallback ke HTTP polling.

### "Failed to get accumulator value"

Solution:
- Pastikan backend API running di `http://localhost:3001`
- Atau set `L2_API_URL` ke URL yang benar

### "Error: insufficient funds"

Solution:
- Pastikan operator wallet punya ETH di Sepolia (untuk L1 tx)
- Pastikan L2 operator wallet punya ETH di Anvil (untuk L2 tx)

### "Already processed" for all deposits

Solution:
- Delete `.relay_state.json` untuk reset state
- Atau set `L1_FROM_BLOCK` ke block yang lebih baru

## 📝 Best Practices

1. **Use WebSocket**: Lebih cepat dan efisien daripada HTTP polling
2. **Monitor Logs**: Watch for errors dan failed submissions
3. **Backup State**: Save `.relay_state.json` secara berkala
4. **Operator Funds**: Selalu pastikan ada ETH untuk gas fees
5. **Backend Running**: Relay depends on backend API untuk accumulator value

## 🚀 Production Deployment

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Build relay
cd relay
npm run build

# Start with PM2
pm2 start dist/relay.js --name plasma-relay

# Auto-restart on crash
pm2 startup
pm2 save
```

### Using systemd

Create `/etc/systemd/system/plasma-relay.service`:

```ini
[Unit]
Description=Plasma ECC Relay Service
After=network.target

[Service]
Type=simple
User=plasma
WorkingDirectory=/home/plasma/plasma-ecc-2/relay
ExecStart=/usr/bin/node dist/relay.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable & start:
```bash
sudo systemctl enable plasma-relay
sudo systemctl start plasma-relay
sudo systemctl status plasma-relay
```

## 📄 License

MIT

## 👨‍💻 Author

Plasma ECC Project - TypeScript + Viem Migration

---

**Happy Relaying! 🚀**
