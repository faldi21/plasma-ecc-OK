TPS Test for Plasma ECC 2
===========================

This folder contains scripts to test the throughput of the Plasma Layer 2 network.

Prerequisites
-------------
- Backend server running (npm run dev in backend folder)
- Anvil chain running
- Node.js installed

Scripts
-------

run-tps.js
----------
Executes a load test by sending transactions from 3 pre-funded accounts.

Usage:
  node run-tps.js

Configuration:
Edit run-tps.js to change:
- TOTAL_TRANSACTIONS: Total number of transactions to send.
- ACCOUNTS: List of private keys to use (more accounts = higher potential TPS).

Results
-------
The script outputs:
- Total Time
- Total Requests
- Successful/Failed counts
- Throughput (TPS)

Note:
The current backend implementation enforces strict nonce checking against the on-chain state. This limits the throughput per account to 1 / block_time (approx 0.5 TPS). To achieve higher aggregate TPS, use more accounts.
