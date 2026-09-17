#!/usr/bin/env bash
#
# Anvil launcher for the Paper 1 campaign, with the account funding the
# harness needs already done.
#
# Why this exists: a freshly started Anvil funds only its own default
# accounts. The harness signs with OPERATOR/L2_OPERATOR_PRIVATE_KEY (see
# bench/harness/accounts.ts loadOperatorPrivateKey), which is a
# project-specific key Anvil has never heard of, so its balance is 0 and
# the very first contract deploy fails at eth_estimateGas with
# "Transaction creation failed". During the campaign this was patched by
# hand every time the node restarted; this script does it automatically.
#
# The anvil flags below are EXACTLY the ones Makefile.paper1's p1-anvil
# target used before this script existed -- they are part of the measured
# environment (docs/EXPERIMENT_PRD.md §2, recorded in each run's
# manifest.json as anvil_launch_args). Do not add or remove flags here.
#
# Usage: scripts/anvil_paper1.sh     (or: make anvil)
# Ctrl-C stops Anvil; the trap below makes sure it is never orphaned.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# .env first, .env.paper1 second so campaign parameters win, matching the
# load order every bench/*.ts script uses (dotenv with override: true).
set -a
[ -f .env ] && . ./.env
[ -f .env.paper1 ] && . ./.env.paper1
set +a

ANVIL_PORT="${ANVIL_PORT:?ANVIL_PORT not set (.env.paper1)}"
ANVIL_GAS_LIMIT="${ANVIL_GAS_LIMIT:?ANVIL_GAS_LIMIT not set (.env.paper1)}"
ANVIL_FUND_ETH="${ANVIL_FUND_ETH:-10000}"
RPC="http://127.0.0.1:${ANVIL_PORT}"

# Anvil's own default account #0: a published, deterministic dev key from
# the standard "test test ... junk" mnemonic. It exists only on a local
# chain, holds no real value, and is the account every Anvil user already
# has -- which is why it is the funding source here.
ANVIL_ACCOUNT0_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ANVIL_ACCOUNT0_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# Which env vars hold keys that must be funded on the local chain.
#
# Traced from bench/ rather than assumed:
#   L2_OPERATOR_PRIVATE_KEY / OPERATOR_PRIVATE_KEY
#       loadOperatorPrivateKey() prefers the first and falls back to the
#       second; this account deploys every contract and sends every
#       operator transaction in E1, E2's L2 phase and E3. THIS is the one
#       whose absence broke E3.
#   DEPLOYER_PRIVATE_KEY
#       NOT used anywhere under bench/ (grep is clean) -- it belongs to
#       script/*.s.sol, the Foundry deploy scripts. Funded anyway because
#       it costs nothing on a local chain and pointing those scripts at
#       Anvil is an obvious next thing to try.
#
# E3's K sender accounts and its warm-up account are NOT here on purpose:
# they are derived per cell from that cell's seed (deriveAccountKey) and
# bench/e3_throughput.ts funds them itself with anvil_setBalance. They
# change every cell, so pre-funding them here would be meaningless.
ANVIL_FUND_KEY_VARS="${ANVIL_FUND_KEY_VARS:-L2_OPERATOR_PRIVATE_KEY OPERATOR_PRIVATE_KEY DEPLOYER_PRIVATE_KEY}"

echo "[anvil_paper1] starting: anvil --port ${ANVIL_PORT} --gas-limit ${ANVIL_GAS_LIMIT} --chain-id 31337"
anvil --port "$ANVIL_PORT" --gas-limit "$ANVIL_GAS_LIMIT" --chain-id 31337 &
ANVIL_PID=$!

cleanup() {
  if kill -0 "$ANVIL_PID" 2>/dev/null; then
    echo "[anvil_paper1] stopping anvil (pid ${ANVIL_PID})"
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

# Readiness by polling eth_blockNumber, not by sleeping a guessed interval.
echo -n "[anvil_paper1] waiting for RPC at ${RPC} "
READY=0
for _ in $(seq 1 60); do
  if cast block-number --rpc-url "$RPC" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$ANVIL_PID" 2>/dev/null; then
    echo
    echo "[anvil_paper1] FATAL: anvil exited before the RPC came up." >&2
    exit 1
  fi
  echo -n "."
  sleep 0.5
done
echo
if [ "$READY" -ne 1 ]; then
  echo "[anvil_paper1] FATAL: RPC not ready after 30s at ${RPC}." >&2
  exit 1
fi

FUND_WEI="$(cast to-wei "$ANVIL_FUND_ETH" ether)"

# Collect the target addresses, de-duplicated: L2_OPERATOR_PRIVATE_KEY and
# OPERATOR_PRIVATE_KEY are frequently the same key, and funding one
# address twice would just waste a transaction.
declare -a TARGET_ADDRS=()
declare -a TARGET_LABELS=()
for var in $ANVIL_FUND_KEY_VARS; do
  key="${!var:-}"
  [ -n "$key" ] || { echo "[anvil_paper1] ${var}: not set, skipping"; continue; }
  addr="$(cast wallet address --private-key "$key" 2>/dev/null || true)"
  if [ -z "$addr" ]; then
    echo "[anvil_paper1] ${var}: not a valid private key, skipping" >&2
    continue
  fi
  seen=0
  for i in "${!TARGET_ADDRS[@]}"; do
    if [ "${TARGET_ADDRS[$i]}" = "$addr" ]; then
      TARGET_LABELS[$i]="${TARGET_LABELS[$i]},${var}"
      seen=1
      break
    fi
  done
  if [ "$seen" -eq 0 ]; then
    TARGET_ADDRS+=("$addr")
    TARGET_LABELS+=("$var")
  fi
done

# Anvil's account #0 starts with exactly 10000 ETH, so it cannot transfer
# a full 10000 ETH to anyone (gas alone makes it short). Top the funder up
# first -- the cheat is applied ONLY to the funding account, never to a
# measured one, and every target below still receives a real transfer from
# account #0 as intended.
NEEDED_WEI="$(( ${#TARGET_ADDRS[@]} + 1 ))"
TOPUP_WEI="$(.venv/bin/python3 -c "print(hex(${FUND_WEI} * ${NEEDED_WEI}))" 2>/dev/null || python3 -c "print(hex(${FUND_WEI} * ${NEEDED_WEI}))")"
cast rpc anvil_setBalance "$ANVIL_ACCOUNT0_ADDR" "$TOPUP_WEI" --rpc-url "$RPC" >/dev/null

echo "[anvil_paper1] funding target: ${ANVIL_FUND_ETH} ETH per account, from anvil account #0 (${ANVIL_ACCOUNT0_ADDR})"
for i in "${!TARGET_ADDRS[@]}"; do
  addr="${TARGET_ADDRS[$i]}"
  label="${TARGET_LABELS[$i]}"
  bal_wei="$(cast balance "$addr" --rpc-url "$RPC")"
  if [ "$(printf '%s\n%s\n' "$bal_wei" "$FUND_WEI" | sort -g | head -1)" = "$FUND_WEI" ]; then
    action="already funded"
  else
    cast send --private-key "$ANVIL_ACCOUNT0_KEY" --value "$FUND_WEI" "$addr" --rpc-url "$RPC" >/dev/null
    bal_wei="$(cast balance "$addr" --rpc-url "$RPC")"
    action="funded"
  fi
  printf '[anvil_paper1] %-28s %s  %s ETH  (%s)\n' "$label" "$addr" "$(cast from-wei "$bal_wei" ether)" "$action"
done

echo "[anvil_paper1] ready on ${RPC} -- Ctrl-C to stop"
wait "$ANVIL_PID"
