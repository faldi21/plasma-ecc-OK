# 🚀 Quick Start - Balance Check Scripts

## ✅ Scripts Siap Digunakan!

Environment variables sudah terkonfigurasi dengan benar dan semua script siap digunakan.

---

## 📋 Available Scripts

### 1. Test Environment (Rekomendasi untuk pertama kali)

```bash
npx tsx functions/test-env.ts
```

**Output:**
```
✅ .env loaded successfully!

🔍 Environment Variables Check:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ SEPOLIA_RPC_URL                = https://sepolia.infura.io/v3/...
✅ L2_RPC_URL                     = http://localhost:8545
✅ ROOT_CHAIN_ADDRESS             = 0xdc308f17d84b727351530b6c35e7454db3bfebb0
✅ PLASMA_TOKEN_ADDRESS           = 0x76eab394dbc12e34fa6418587bc7d7f9e339117c
✅ L2_PLASMA_CHAIN_ADDRESS        = 0x94B75AA39bEC4cB15e7B9593C315aF203B7B847f
✅ L2_PLASMA_TOKEN_ADDRESS        = 0xF6168876932289D073567f347121A267095f3DD6
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ All required environment variables found!
✅ Scripts are ready to use!
```

---

### 2. Check L2 Balance (Simple)

```bash
# Run from anywhere in the project
npx tsx functions/3-check-l2-balance.ts
```

**Check specific addresses:**
```bash
npx tsx functions/3-check-l2-balance.ts 0xYourAddress1 0xYourAddress2
```

---

### 3. Check Balance Advanced (L1 + L2)

```bash
# Table view
npx tsx functions/4-check-balance-advanced.ts

# Detailed view
npx tsx functions/4-check-balance-advanced.ts --detailed

# Export to JSON/CSV
npx tsx functions/4-check-balance-advanced.ts --json --csv
```

---

### 4. Check via API (Paling Mudah)

**Prerequisites:** Backend harus running

```bash
# Terminal 1 - Start backend
cd backend && npm run dev

# Terminal 2 - Check balance
npx tsx functions/5-check-balance-api.ts

# With pending transactions
npx tsx functions/5-check-balance-api.ts --pending
```

---

## 🔧 Prerequisites

### 1. Pastikan L2 (Anvil) Running

```bash
# Terminal baru
anvil
```

### 2. Pastikan Contract Sudah Deployed

```bash
# Check apakah address di .env valid
npx tsx functions/test-env.ts
```

---

## 💡 Tips

### Buat Alias untuk Kemudahan

Tambahkan ke `~/.bashrc` atau `~/.zshrc`:

```bash
# Plasma ECC aliases
alias check-env="npx tsx functions/test-env.ts"
alias check-l2="npx tsx functions/3-check-l2-balance.ts"
alias check-all="npx tsx functions/4-check-balance-advanced.ts --detailed"
alias check-api="npx tsx functions/5-check-balance-api.ts"

# Navigate to project
alias go-plasma="cd ~/plasma-ecc-2"
```

Lalu:
```bash
source ~/.bashrc  # atau source ~/.zshrc
```

Sekarang bisa langsung:
```bash
check-env
check-l2
check-all
check-api
```

---

## 🐛 Troubleshooting

### Error: "L2_PLASMA_CHAIN_ADDRESS not found"

✅ **SUDAH DIPERBAIKI!** Script sekarang otomatis membaca `.env` dari folder project root.

---

### Error: "Contract function returned no data"

**Penyebab:** L2 (Anvil) tidak running atau contract belum deployed.

**Solusi:**
```bash
# Start Anvil
anvil

# Deploy L2 contracts (jika belum)
node script/deploy-l2.js
```

---

### Error: "Cannot find module tsx"

**Solusi:**
```bash
# Install globally
npm install -g tsx

# Atau gunakan npx (akan auto-install)
npx tsx functions/3-check-l2-balance.ts
```

---

### Error: "Backend API is not available"

**Solusi:**
```bash
cd backend
npm run dev
```

---

## 📊 Workflow Lengkap

### Scenario 1: Development (Lokal)

```bash
# 1. Start Anvil
anvil

# 2. Deploy contracts (jika perlu)
node script/deploy-l2.js

# 3. Start backend
cd backend && npm run dev

# 4. Check balances
npx tsx functions/3-check-l2-balance.ts
```

---

### Scenario 2: Test Deposit & Transfer

```bash
# 1. Mint test tokens
node functions/1-get-tokens.js

# 2. Check balance sebelum
npx tsx functions/3-check-l2-balance.ts 0xYourAddress

# 3. Test deposit
node functions/2-test-deposit.js

# 4. Check balance setelah deposit
npx tsx functions/3-check-l2-balance.ts 0xYourAddress

# 5. Transfer tokens ke address lain (specify sender private key)
npx tsx functions/6-transfer-plasma-l2.ts \
  0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  0xRecipientAddress \
  100

# 6. Check balance setelah transfer
npx tsx functions/3-check-l2-balance.ts 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 0xRecipientAddress

# 7. Check transfer status
npx tsx functions/7-check-transfer.ts
```

---

### Scenario 3: Monitor & Export

```bash
# Monitor terus-menerus (setiap 5 detik)
watch -n 5 "npx tsx functions/3-check-l2-balance.ts"

# Export semua balances
npx tsx functions/4-check-balance-advanced.ts --json --csv

# Lihat hasil export
ls -lh balances-*.json balances-*.csv
```

---

## 📁 File Locations

Semua script **automatically** membaca file dari lokasi yang benar:

```
/home/faldi/plasma-ecc-2/
├── .env                          ← Script baca dari sini
├── functions/
│   ├── 3-check-l2-balance.ts    ← Run dari mana saja!
│   ├── 4-check-balance-advanced.ts
│   └── 5-check-balance-api.ts
└── backend/
    └── abi/
        └── PlasmaChain.json      ← Auto-loaded
```

**Anda bisa run script dari folder mana saja!**

```bash
# Dari root project
npx tsx functions/3-check-l2-balance.ts

# Dari functions/
cd functions
npx tsx 3-check-l2-balance.ts

# Dari backend/
cd backend
npx tsx ../functions/3-check-l2-balance.ts
```

Semua akan bekerja! 🎉

---

## ✅ Summary

### Fixed Issues
- ✅ `.env` sekarang auto-load dari project root
- ✅ ABI files auto-load dari lokasi yang benar
- ✅ Bisa run dari folder mana saja
- ✅ Environment variables terdeteksi dengan benar

### Ready to Use
- ✅ `test-env.ts` - Verify environment
- ✅ `3-check-l2-balance.ts` - Simple balance check
- ✅ `4-check-balance-advanced.ts` - Advanced with export
- ✅ `5-check-balance-api.ts` - Via backend API
- ✅ `6-transfer-plasma-l2.ts` - Transfer PLASMA tokens
- ✅ `7-check-transfer.ts` - Check transfer status

---

**Happy checking & transferring!** 🚀
