# Plasma-UTXO-ECC: Elliptic Curve Accumulator for Layer 2 Plasma with UTXO Model

> **IEEE Scopus Q1 Research Implementation**  
> A comparative study of ECC Accumulator vs. Merkle Tree as membership-proof primitives in a Plasma Layer 2 blockchain with UTXO transaction model.

---

## Overview

This repository implements a **Plasma Layer 2** system using the **UTXO (Unspent Transaction Output)** model, featuring two interchangeable accumulator primitives:

| Primitive | Contract | Proof Size | Block Commit Gas |
|---|---|---|---|
| **ECC Accumulator** (secp256k1) | `PlasmaChainUTXO.sol` | **64 bytes** (constant O(1)) | ~1.65M gas/element |
| **Merkle Tree Baseline** (OZ v5.5.0) | `PlasmaChainUTXOMerkle.sol` | 32×⌈log₂n⌉ bytes (O(log n)) | ~85K gas/element |

Key architectural contribution: a **deferred-commitment design** that decouples accumulator overhead from transactional hot path, enabling both primitives to achieve equivalent throughput (~4,800 TPS peak) while differing only in block-commit cost and proof bandwidth.

---

## Architecture

```
L1 (Ethereum / Sepolia)
├── RootChainUTXO.sol        — deposit lock, block anchoring, exit game
└── PlasmaToken.sol          — ERC-20 test token

L2 (Anvil / Local)
├── PlasmaChainUTXO.sol      — ECC accumulator (proposed)
│   └── ECCAccumulator.sol   — secp256k1 scalar multiplication
├── PlasmaChainUTXOMerkle.sol — Merkle baseline (comparison)
│   └── MerkleAccumulator.sol — OZ Bytes32PushTree, depth=20

Backend (Node.js / TypeScript)
├── PlasmaServiceUTXO.ts     — L1↔L2 relay, block submission
├── TpsTestRunner.ts         — Live TPS benchmark (batch mode)
├── CryptoCalibration.ts     — Gas measurement (N=10 isolated runs)
├── ProofSizeValidator.ts    — Empirical proof size validation
└── VerifyGasMeasurement.ts  — Isolated witness verify cost

Frontend (React / Vite)
└── TestingResults.tsx       — Paper Tables 2–4 dashboard
```

### Deferred-Commitment Design

```
deposit / transfer / withdrawal
    └── storage write only (NO accumulator.add)
         └── gas: ~240K–330K (identical for ECC and Merkle)

createBlock()
    └── batch loop: for each pendingUtxo → accumulator.add()
         ├── ECC:    1× scalarMul per element  → ~1.65M gas
         └── Merkle: log₂(n) keccak256 hashes → ~85K gas
```

---

## Project Structure

```
plasma-ecc-OK/
├── src/
│   ├── PlasmaChainUTXO.sol          # L2 contract — ECC accumulator
│   ├── PlasmaChainUTXOMerkle.sol    # L2 contract — Merkle baseline
│   ├── RootChainUTXO.sol            # L1 contract
│   ├── PlasmaToken.sol              # ERC-20 test token
│   └── libraries/
│       ├── ECCAccumulator.sol       # secp256k1 point operations
│       └── MerkleAccumulator.sol    # OZ MerkleTree wrapper
├── script/
│   ├── DeployUTXO.s.sol             # Deploy ECC L2 contract
│   └── DeployUTXOMerkle.s.sol       # Deploy Merkle L2 contract
├── backend/
│   ├── src/
│   │   ├── server-utxo.ts           # REST API server
│   │   ├── plasma/
│   │   │   ├── PlasmaServiceUTXO.ts # L1↔L2 relay
│   │   │   ├── TpsTestRunner.ts     # TPS benchmark engine
│   │   │   ├── CryptoCalibration.ts # Gas calibration (Table 3)
│   │   │   ├── ProofSizeValidator.ts# Proof size validation (Table 2)
│   │   │   └── VerifyGasMeasurement.ts # Isolated verify cost
│   │   └── config/
│   │       ├── env.ts               # Environment config
│   │       └── abis.ts              # ABI loaders
│   └── abi/
│       ├── PlasmaChainUTXO.json
│       └── PlasmaChainUTXOMerkle.json
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── TestingResults.tsx   # Paper Tables 2–4 dashboard
│       │   └── BalanceTable.tsx     # L2 UTXO balance viewer
│       └── abis/
│           ├── PlasmaChainUTXO.json
│           └── PlasmaChainUTXOMerkle.json
├── foundry.toml
└── anvil.sh                         # Anvil L2 node manager
```

---

## Quick Start

### Prerequisites

```bash
# Foundry (forge + cast + anvil)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Node.js 18+
node --version

# Install dependencies
cd backend && npm install
cd ../frontend && npm install
```

### Environment

Copy `.env.example` to `.env` and fill in:

```env
# L2 (Anvil)
L2_RPC_URL=http://localhost:8545
OPERATOR_PRIVATE_KEY=
L2_OPERATOR_PRIVATE_KEY=

# Contract addresses (filled after deploy)
PLASMA_CHAIN_UTXO_ADDRESS=
PLASMA_CHAIN_UTXO_MERKLE_ADDRESS=
L2_PLASMA_TOKEN_ADDRESS=

# L1 (Sepolia)
L1_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
ROOT_CHAIN_UTXO_ADDRESS=

# (Opsional) 
#L1_FROM_BLOCK=0
```

### Run

**1. Start L2 (Anvil)**
```bash
./anvil.sh start-fresh
```

**2. Deploy contracts**
```bash
# ECC accumulator
forge script script/DeployUTXO.s.sol:DeployL2UTXO \
  --rpc-url http://localhost:8545 --broadcast

# Merkle baseline
forge script script/DeployUTXOMerkle.s.sol:DeployL2UTXOMerkle \
  --rpc-url http://localhost:8545 --broadcast
```

Update `.env` with the deployed addresses.

**3. Sync ABIs**
```bash
jq '.abi' out/PlasmaChainUTXO.sol/PlasmaChainUTXO.json > frontend/src/abis/PlasmaChainUTXO.json
jq '.abi' out/PlasmaChainUTXOMerkle.sol/PlasmaChainUTXOMerkle.json > frontend/src/abis/PlasmaChainUTXOMerkle.json
cp out/PlasmaChainUTXO.sol/PlasmaChainUTXO.json backend/abi/PlasmaChainUTXO.json
cp out/PlasmaChainUTXOMerkle.sol/PlasmaChainUTXOMerkle.json backend/abi/PlasmaChainUTXOMerkle.json
```

**4. Start backend**
```bash
cd backend && npm run dev:utxo
```

**5. Start relay**
```bash
cd relay && npm run dev:utxo
```

**6. Start frontend**
```bash
cd frontend && npm run dev
# Open http://localhost:5173
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/test/tps/start` | Start TPS benchmark |
| `GET` | `/api/test/tps/status` | Live benchmark status |
| `GET` | `/api/test/tps/history` | All benchmark runs |
| `POST` | `/api/test/tps/start-multi` | Multi-run benchmark (N repeats) |
| `POST` | `/api/test/calibration/run` | Gas calibration (Table 3) |
| `GET` | `/api/test/calibration/latest` | Last calibration result |
| `POST` | `/api/test/verify-gas/run` | Isolated verify-step gas (Table 3b) |
| `GET` | `/api/test/proof-size-validation` | Empirical proof size (Table 2) |

---

## Benchmark Configuration

| Parameter | Recommended | Description |
|---|---|---|
| `totalTransactions` | 1000–2000 | Number of sub-operations |
| `concurrency` | 3 | Parallel sender slots |
| `batchSize` | 100–300 | Sub-ops per batch transaction |
| `createBlockEvery` | 0 | 0 = deferred (hot-path benchmark) |
| `revertAfter` | true | Revert Anvil state after test |
| `mode` | `ecc` \| `merkle` | Accumulator primitive |

---

## Paper Citation

> [Author]. "Plasma-UTXO with ECC Accumulator: A Deferred-Commitment Architecture for Scalable Layer 2 Blockchain." *IEEE [Journal/Conference]*, 2026.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Solidity 0.8.30, Foundry |
| Cryptography | secp256k1 (ECC), keccak256 (Merkle) |
| Merkle Library | OpenZeppelin Contracts v5.5.0 |
| L2 Node | Anvil (Foundry) |
| Backend | Node.js, TypeScript, Viem |
| Frontend | React, Vite, TailwindCSS, shadcn/ui |
| L1 Testnet | Ethereum Sepolia |

---

## License

MIT
