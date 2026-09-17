#!/usr/bin/env bash
#
# Fetches the Sepolia receipt for every L1 record in a RUN_ID and saves it
# as data/receipts/<RUN_ID>/<tx_hash>.json -- the filename verify.sh's D6
# check looks for.
#
# This is FACT RETRIEVAL, not data creation. Nothing under data/raw/ is
# read for anything but tx_hash, and nothing there is ever written. The
# receipt is whatever the public chain returns.
#
# The gasUsed in each fetched receipt is compared against the gas_used
# recorded during the campaign. A mismatch is a FINDING and is reported
# loudly (and makes this script exit non-zero) -- it is never reconciled,
# smoothed, or written back.
#
# Usage:
#   RUN_ID=<id> bash scripts/fetch_receipts.sh
#   bash scripts/fetch_receipts.sh <RUN_ID>
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

set -a
[ -f .env ] && . ./.env
[ -f .env.paper1 ] && . ./.env.paper1
set +a

RUN_ID="${1:-${RUN_ID:-}}"
DATA_ROOT="${DATA_ROOT:-data}"
RPC="${SEPOLIA_RPC_URL:-${L1_RPC:-}}"

if [[ -z "$RUN_ID" ]]; then
  echo "FATAL: RUN_ID belum ditentukan. Pakai: RUN_ID=<id> bash scripts/fetch_receipts.sh" >&2
  echo "       (data/LATEST tidak dipakai sebagai default di sini: sejak E3 dibekukan" >&2
  echo "        terpisah, LATEST menunjuk dataset E3, bukan dataset L1 utama.)" >&2
  exit 2
fi
if [[ -z "$RPC" ]]; then
  echo "FATAL: SEPOLIA_RPC_URL (atau L1_RPC) belum diset di .env" >&2
  exit 2
fi

RAW="$DATA_ROOT/raw/$RUN_ID"
OUT="$DATA_ROOT/receipts/$RUN_ID"
[[ -d "$RAW" ]] || { echo "FATAL: $RAW tidak ada" >&2; exit 2; }
mkdir -p "$OUT"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# (tx_hash, cell_id, repetition, recorded gas_used) for every record whose
# measurement venue is Sepolia -- the only records whose receipt a public
# node can possibly return (ANALYSIS_PLAN.md Amandemen 4). Venue comes from
# analysis/common.venue_of(), the same single definition verify.sh D6 and
# aggregate.py use, so the three can never drift apart.
python3 - "$RAW" > "$WORK/records.tsv" <<'PY'
import glob, json, os, sys
sys.path.insert(0, "analysis")
from common import VENUE_SEPOLIA, venue_of

raw = sys.argv[1]
skipped = {}
for path in sorted(glob.glob(f"{raw}/*.jsonl")):
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        if rec.get("layer") != "L1":
            continue
        if str(rec.get("cell_id", "")).startswith("e4."):
            continue
        if venue_of(rec) != VENUE_SEPOLIA:
            skipped[rec.get("cell_id")] = skipped.get(rec.get("cell_id"), 0) + 1
            continue
        h = rec.get("tx_hash")
        if not h:
            continue
        print("\t".join([h, str(rec.get("cell_id")), str(rec.get("repetition")), str(rec.get("gas_used"))]))
for cell, n in sorted(skipped.items()):
    print(f"[fetch_receipts] dilewati (venue lokal, tidak ada di Sepolia): {cell} x{n}", file=sys.stderr)
PY

total=$(wc -l < "$WORK/records.tsv")
uniq_hashes=$(cut -f1 "$WORK/records.tsv" | sort -u | wc -l)
echo "[fetch_receipts] RUN_ID=$RUN_ID"
echo "[fetch_receipts] $total record ber-venue sepolia, $uniq_hashes hash unik -> $OUT"

fetched=0; cached=0; notfound=0; failed=0
: > "$WORK/notfound.txt"

while IFS= read -r h; do
  dest="$OUT/$h.json"
  if [[ -s "$dest" ]]; then
    cached=$((cached+1))
    continue
  fi
  ok=0
  for attempt in 1 2 3; do
    # --async is REQUIRED: without it `cast receipt` blocks forever waiting
    # for an unknown hash to be mined instead of reporting "tx not found",
    # which hung an earlier version of this script indefinitely. timeout is
    # the belt-and-braces guard for a wedged RPC connection.
    if timeout 60 cast receipt "$h" --json --async --rpc-url "$RPC" > "$WORK/r.json" 2>"$WORK/err.txt"; then
      if [[ -s "$WORK/r.json" ]] && grep -q '"transactionHash"' "$WORK/r.json"; then
        mv "$WORK/r.json" "$dest"
        fetched=$((fetched+1)); ok=1
        break
      fi
    fi
    if grep -qi "not found" "$WORK/err.txt"; then
      notfound=$((notfound+1)); echo "$h" >> "$WORK/notfound.txt"; ok=2
      break
    fi
    sleep $((attempt * 2))
  done
  if [[ "$ok" -eq 0 ]]; then
    failed=$((failed+1))
    echo "  GAGAL ambil $h: $(head -c 120 "$WORK/err.txt" | tr '\n' ' ')" >&2
  fi
done < <(cut -f1 "$WORK/records.tsv" | sort -u)

echo "[fetch_receipts] diambil=$fetched sudah-ada=$cached tidak-ada-di-sepolia=$notfound gagal=$failed"

# ---- compare recorded gas_used against the receipt's own gasUsed --------
python3 - "$WORK/records.tsv" "$OUT" "$WORK/notfound.txt" <<'PY'
import json, os, sys

records_tsv, out_dir, notfound_path = sys.argv[1], sys.argv[2], sys.argv[3]
notfound = set(l.strip() for l in open(notfound_path) if l.strip())

checked = mismatch = missing = 0
mismatches = []
for line in open(records_tsv):
    h, cell, rep, recorded = line.rstrip("\n").split("\t")
    path = os.path.join(out_dir, h + ".json")
    if not os.path.exists(path):
        missing += 1
        continue
    receipt = json.load(open(path))
    raw_gas = receipt.get("gasUsed")
    chain_gas = int(raw_gas, 16) if isinstance(raw_gas, str) and raw_gas.startswith("0x") else int(raw_gas)
    checked += 1
    if recorded in ("None", "null", ""):
        mismatches.append((cell, rep, h, recorded, chain_gas, "record tidak punya gas_used"))
        mismatch += 1
    elif int(recorded) != chain_gas:
        mismatches.append((cell, rep, h, recorded, chain_gas, "BEDA"))
        mismatch += 1

print()
print("=== perbandingan gas_used tercatat vs gasUsed di receipt ===")
print(f"  dibandingkan : {checked}")
print(f"  cocok        : {checked - mismatch}")
print(f"  TIDAK COCOK  : {mismatch}")
print(f"  tanpa receipt: {missing}" + (f" (di antaranya {len(notfound)} hash tidak ada di Sepolia)" if notfound else ""))
for cell, rep, h, recorded, chain_gas, why in mismatches:
    print(f"  !! {cell} rep{rep} {h}: tercatat={recorded} receipt={chain_gas} ({why})")

if notfound:
    print()
    print("=== hash yang TIDAK ADA di Sepolia (temuan, bukan kegagalan skrip) ===")
    from collections import Counter
    cells = Counter()
    for line in open(records_tsv):
        h, cell, rep, _ = line.rstrip("\n").split("\t")
        if h in notfound:
            cells[cell] += 1
    for cell, n in sorted(cells.items()):
        print(f"  {cell}: {n} record")

sys.exit(1 if mismatch else 0)
PY
cmp_status=$?

if [[ "$failed" -gt 0 ]]; then
  echo "[fetch_receipts] SELESAI DENGAN GALAT JARINGAN: $failed hash gagal diambil, jalankan ulang (idempoten)." >&2
  exit 1
fi
exit "$cmp_status"
