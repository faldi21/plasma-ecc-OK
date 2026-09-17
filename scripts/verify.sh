#!/usr/bin/env bash
# scripts/verify.sh — cek Definition of Done D1..D7 (docs/EXPERIMENT_PRD.md §0)
# (docs/TICKETS.md T9; canonical path per CLAUDE.md's "Perintah" section --
# scripts/verify_paper1.sh, the name this file started under, is now a
# thin backward-compatible wrapper around this one.)
#
# Layout: repo kode ~/plasma-ecc-OK, repo paper ~/paper1 (sejajar, tidak nested).
#
# Pakai:
#   make verify
# atau:
#   RUN_ID=20260920-141233-a3f19c2 bash scripts/verify.sh
#
# Keluar dengan kode != 0 kalau ada kriteria yang gagal.
# Skrip ini hanya membaca; tidak pernah mengubah data/ atau paper/.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

[[ -f .env.paper1 ]] && source .env.paper1

PAPER1_DIR="${PAPER1_DIR:-$HOME/paper1}"
PAPER_TEX="${PAPER_TEX:-$PAPER1_DIR/main_rev1.tex}"
TABLES_DIR="${TABLES_DIR:-$PAPER1_DIR/tables}"
DATA_ROOT="${DATA_ROOT:-data}"
RUN_ID="${RUN_ID:-$(cat "$DATA_ROOT/LATEST" 2>/dev/null || true)}"
# E3 is frozen as its OWN dataset with its own tag (ANALYSIS_PLAN.md
# Amandemen 2). Defaults to RUN_ID so single-dataset runs behave exactly
# as before. The two raw directories are checked separately and never
# merged.
RUN_ID_E3="${RUN_ID_E3:-$RUN_ID}"
FREEZE_TAG_E3="${FREEZE_TAG_E3:-}"
MIN_N="${MIN_N:-30}"          # N minimum per sel (kecuali sel L1)
MIN_N_L1="${MIN_N_L1:-5}"     # N minimum untuk sel yang mengirim tx L1
FREEZE_TAG="${FREEZE_TAG:-paper1-rev1-frozen}"

pass=0; fail=0; skip=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
warn() { printf '  \033[33mSKIP\033[0m  %s\n' "$1"; skip=$((skip+1)); }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

if [[ -z "$RUN_ID" ]]; then
  echo "RUN_ID belum diset dan $DATA_ROOT/LATEST tidak ada. Jalankan: make freeze" >&2
  exit 2
fi

RAW="$DATA_ROOT/raw/$RUN_ID"
PROC="$DATA_ROOT/processed/$RUN_ID"
RECEIPTS="$DATA_ROOT/receipts/$RUN_ID"
RAW_E3="$DATA_ROOT/raw/$RUN_ID_E3"
PROC_E3="$DATA_ROOT/processed/$RUN_ID_E3"
# Every raw dataset this verification covers, de-duplicated.
RAW_DIRS=("$RAW")
[[ "$RUN_ID_E3" != "$RUN_ID" ]] && RAW_DIRS+=("$RAW_E3")

printf '\n\033[1mverify\033[0m  RUN_ID=%s\n  paper: %s\n  data : %s\n' "$RUN_ID" "$PAPER_TEX" "$RAW"
if [[ "$RUN_ID_E3" != "$RUN_ID" ]]; then
  printf '  E3   : RUN_ID_E3=%s (dataset terpisah, %s)\n' "$RUN_ID_E3" "$RAW_E3"
fi

# ---------------------------------------------------------------- D1
hdr "D1  Semua \\fillin{} sudah terisi (kecuali satu placeholder DOI)"
if [[ -f "$PAPER_TEX" ]]; then
  python3 - "$PAPER_TEX" <<'PY'
import re, sys

paper = sys.argv[1]
text = open(paper, encoding="utf-8", errors="replace").read()

# The ONE placeholder D1 tolerates, matched as an exact literal. This is a
# deliberate, narrow exemption for a value that cannot exist yet: the
# Zenodo DOI is minted on acceptance. It is NOT a loose pattern -- an
# approximate rule like "ignore any \fillin mentioning DOI" would let a
# genuinely unfilled number ride along inside a plausible-looking label,
# which is exactly the failure mode D1 exists to catch.
DOI_PLACEHOLDER = "Zenodo DOI, to be inserted on acceptance"

# Count USES, not the macro's own definition. \long\def\fillin#1{...}
# writes "\fillin#1", never "\fillin{", so requiring the brace already
# excludes it; the explicit \def/\newcommand guard below covers the other
# spellings. The previous version of this check grep'd for the bare
# string and so counted the two definition lines as leftover placeholders
# -- a fully finished paper could never pass it.
def uses(macro: str) -> list[str]:
    found = []
    for line in text.splitlines():
        if re.search(r"\\(?:long\\)?\\?def\\" + macro, line) or f"\\newcommand{{\\{macro}}}" in line:
            continue
        found.extend(re.findall(r"\\" + macro + r"\{([^{}]*)\}", line))
        # A nested-brace argument would slip past the regex above; count
        # the openers too and report the discrepancy rather than pass.
        opens = len(re.findall(r"\\" + macro + r"\{", line))
        got = len(re.findall(r"\\" + macro + r"\{([^{}]*)\}", line))
        if opens > got:
            found.extend(["<argumen dengan kurung bersarang, tidak bisa dibaca>"] * (opens - got))
    return found

fillins = uses("fillin")
todos = uses("todo")
bad = 0

if todos:
    print(f"  \033[31mFAIL\033[0m  {len(todos)} penanda \\todo masih ada (teks interpretasi belum ditulis)")
    for t in todos[:5]:
        print(f"           \\todo{{{t}}}")
    bad += 1
else:
    print("  \033[32mPASS\033[0m  tidak ada \\todo tersisa")

others = [f for f in fillins if f != DOI_PLACEHOLDER]
doi_count = len(fillins) - len(others)

if others:
    print(f"  \033[31mFAIL\033[0m  {len(others)} penanda \\fillin masih ada di {paper}")
    for f in others[:8]:
        print(f"           \\fillin{{{f}}}")
    bad += 1
elif doi_count > 1:
    # More than one means a stray copy, not the single citation line.
    print(f"  \033[31mFAIL\033[0m  placeholder DOI muncul {doi_count}x, seharusnya tepat satu")
    bad += 1
elif doi_count == 1:
    # Printed as a PASS but with the count visible: the exemption must
    # stay in sight, not disappear behind a green line.
    print("  \033[32mPASS\033[0m  pass (1 placeholder DOI menunggu acceptance)")
else:
    print("  \033[32mPASS\033[0m  tidak ada \\fillin tersisa")

sys.exit(1 if bad else 0)
PY
  [[ $? -eq 0 ]] || fail=$((fail+1))
else
  warn "paper tidak ditemukan di $PAPER_TEX (set PAPER_TEX=...)"
fi

# ---------------------------------------------------------------- D2
hdr "D2  Tabel dan gambar bisa digenerate ulang secara identik"
if command -v python3 >/dev/null && [[ -d "$PROC" ]]; then
  tmp="$(mktemp -d)"
  # --run-id-e3 is REQUIRED here, not optional: E3 is frozen as its own
  # dataset (ANALYSIS_PLAN.md Amandemen 2), so regenerating without it
  # rebuilds tab_throughput against a RUN_ID that holds no E3 data at all.
  # Every throughput cell then comes out as \fillin{} and D2 reports the
  # table as "berbeda setelah regenerasi (ada edit manual?)" -- blaming a
  # manual edit for what is really this command's own missing argument.
  # The bootstrap CIs are NOT the cause: bootstrap_seed is frozen in
  # ANALYSIS_PLAN.md and make_tables.py is byte-deterministic given the
  # same two RUN_IDs.
  if python3 analysis/make_tables.py --run-id "$RUN_ID" --run-id-e3 "$RUN_ID_E3" --data "$DATA_ROOT" --out "$tmp" >/dev/null 2>&1; then
    diffs=0
    for f in "$TABLES_DIR"/*.tex; do
      [[ -e "$f" ]] || continue
      b="$(basename "$f")"
      if [[ ! -f "$tmp/$b" ]]; then bad "regenerasi tidak menghasilkan $b"; diffs=$((diffs+1)); continue; fi
      cmp -s "$f" "$tmp/$b" || { bad "$b berbeda setelah regenerasi (ada edit manual?)"; diffs=$((diffs+1)); }
    done
    [[ "$diffs" -eq 0 ]] && ok "semua tabel identik setelah regenerasi"
  else
    bad "analysis/make_tables.py gagal dijalankan"
  fi
  rm -rf "$tmp"
else
  warn "python3 atau $PROC tidak tersedia"
fi

# ---------------------------------------------------------------- D3
hdr "D3  Tidak ada angka hasil yang diketik manual di paper"
if [[ -f "$PAPER_TEX" ]]; then
  missing=0
  for t in tab_commit_cost tab_op_gas tab_throughput tab_exploits tab_params; do
    grep -q "input{.*$t}" "$PAPER_TEX" || { bad "$t tidak di-\\input (tabel masih inline?)"; missing=$((missing+1)); }
    [[ -f "$TABLES_DIR/$t.tex" ]] || { bad "$TABLES_DIR/$t.tex belum dihasilkan"; missing=$((missing+1)); }
  done
  [[ "$missing" -eq 0 ]] && ok "semua tabel hasil di-\\input dan tersedia di $TABLES_DIR"

  # heuristik: angka gas besar yang ditulis langsung di badan paper
  if grep -nE '[0-9]{1,3}([.,][0-9]{3}){2,}' "$PAPER_TEX" | grep -vE '\\input|^\s*%' | head -5 | grep -q .; then
    bad "ada angka besar tertulis langsung di paper — cek baris berikut:"
    grep -nE '[0-9]{1,3}([.,][0-9]{3}){2,}' "$PAPER_TEX" | grep -vE '\\input|^\s*%' | head -5 | sed 's/^/        /'
  else
    ok "tidak ada angka hasil besar yang di-hardcode"
  fi
fi

# ---------------------------------------------------------------- D4
hdr "D4  Data mentah level-run tersedia dan cukup"
if [[ -d "$RAW" ]]; then
  files=$(find "${RAW_DIRS[@]}" -name '*.jsonl' 2>/dev/null | wc -l)
  if [[ "$files" -gt 0 ]]; then
    ok "$files berkas JSONL di ${RAW_DIRS[*]}"
    python3 - "$MIN_N" "$MIN_N_L1" "${RAW_DIRS[@]}" <<'PY'
import glob, json, sys, collections
min_n, min_n_l1 = int(sys.argv[1]), int(sys.argv[2])
raw_dirs = sys.argv[3:]
cells = collections.Counter(); layers = {}; bad = 0
for path in [p for d in raw_dirs for p in glob.glob(f"{d}/*.jsonl")]:
    for ln, line in enumerate(open(path), 1):
        line = line.strip()
        if not line: continue
        try: rec = json.loads(line)
        except Exception:
            print(f"  \033[31mFAIL\033[0m  JSON rusak: {path}:{ln}"); bad += 1; continue
        for k in ("run_id","cell_id","repetition","seed","status","env_hash"):
            if k not in rec:
                print(f"  \033[31mFAIL\033[0m  field '{k}' hilang: {path}:{ln}"); bad += 1
        cells[rec.get("cell_id")] += 1
        layers.setdefault(rec.get("cell_id"), set()).add(rec.get("layer"))
for cell, n in sorted(cells.items()):
    # E4 (bench/e4_exploits.ts) cells are deterministic Foundry
    # pass/fail proofs, not a statistical sample -- re-running the same
    # exploit test 5+ times adds no information, so they don't need
    # min_n_l1 either (caught testing this script: it would otherwise
    # fail D4 forever for e4.* cells, which every real campaign has).
    if cell.startswith("e4."):
        need = 1
    else:
        need = min_n_l1 if layers.get(cell) == {"L1"} else min_n
    if n < need:
        print(f"  \033[31mFAIL\033[0m  sel {cell}: N={n} < {need}"); bad += 1
if bad == 0:
    print(f"  \033[32mPASS\033[0m  {len(cells)} sel, semua memenuhi N minimum")
sys.exit(1 if bad else 0)
PY
    [[ $? -eq 0 ]] || fail=$((fail+1))
  else
    bad "tidak ada berkas JSONL di $RAW"
  fi
  # raw harus read-only setelah kampanye
  if find "${RAW_DIRS[@]}" -name '*.jsonl' -perm -u+w 2>/dev/null | grep -q .; then
    bad "data mentah masih writable — jalankan: chmod -w <dir>/*.jsonl untuk ${RAW_DIRS[*]}"
  else
    ok "data mentah read-only"
  fi
else
  bad "direktori $RAW tidak ada"
fi

# ---------------------------------------------------------------- D5
hdr "D5  Test exploit hijau dan namanya sesuai yang dikutip paper"
if command -v forge >/dev/null; then
  if forge test --no-match-test Fuzz -q >/dev/null 2>&1; then ok "forge test hijau"
  else bad "forge test gagal"; fi
  for t in ExploitA1_ExitGriefing ExploitA2_UnbackedExit PropVacuity PropNonBinding; do
    if find contracts/test -name "$t.t.sol" | grep -q .; then ok "ada $t.t.sol"
    else bad "test $t.t.sol tidak ditemukan"; fi
  done
else
  warn "forge tidak terpasang"
fi

# ---------------------------------------------------------------- D6
hdr "D6  Setiap angka L1 bisa ditelusuri sesuai venue pengukurannya"
if [[ -d "$RAW" ]]; then
  python3 - "$RECEIPTS" "${RAW_DIRS[@]}" <<'PY'
import glob, json, os, re, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(".")), "analysis"))
sys.path.insert(0, "analysis")
from common import VENUE_LOCAL, VENUE_SEPOLIA, VenueConflict, venue_of

rcp = sys.argv[1]
raw_dirs = sys.argv[2:]
pat = re.compile(r"^0x[0-9a-fA-F]{64}$")
bad = 0
n_sepolia = n_local = n_e4 = 0

for path in [p for d in raw_dirs for p in glob.glob(f"{d}/*.jsonl")]:
    for ln, line in enumerate(open(path), 1):
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        if rec.get("layer") != "L1":
            continue
        # E4 (bench/e4_exploits.ts) records are Foundry test executions,
        # not chain measurements at all -- layer="L1" there means "this
        # test exercises L1 contract logic". They have no tx_hash, no
        # block_number and no gas_used, so NEITHER venue branch below can
        # say anything about them; they are counted and reported, not
        # silently dropped.
        if str(rec.get("cell_id", "")).startswith("e4."):
            n_e4 += 1
            continue
        try:
            venue = venue_of(rec)
        except VenueConflict as exc:
            print(f"  \033[31mFAIL\033[0m  venue tidak bisa ditentukan: {path}:{ln}: {exc}")
            bad += 1
            continue

        if venue == VENUE_SEPOLIA:
            # Measured on the public network: the receipt is retrievable
            # by anyone, so it must be on disk.
            n_sepolia += 1
            h = rec.get("tx_hash")
            if not h or not pat.match(h):
                print(f"  \033[31mFAIL\033[0m  record sepolia tanpa tx_hash sah: {path}:{ln}")
                bad += 1
                continue
            if os.path.isdir(rcp) and not os.path.exists(os.path.join(rcp, h + ".json")):
                print(f"  \033[31mFAIL\033[0m  receipt hilang untuk {h}")
                bad += 1
        else:
            # Measured on a local devnet that no longer exists, so no
            # receipt can ever be fetched (ANALYSIS_PLAN.md Amandemen 4).
            # What CAN be checked is that the record is self-describing:
            # it names its block and its cost, and says why it ran locally.
            n_local += 1
            if rec.get("block_number") is None:
                print(f"  \033[31mFAIL\033[0m  record lokal tanpa block_number: {path}:{ln}")
                bad += 1
            if rec.get("gas_used") is None:
                print(f"  \033[31mFAIL\033[0m  record lokal tanpa gas_used: {path}:{ln}")
                bad += 1
            if not (rec.get("notes") or "").strip():
                print(f"  \033[31mFAIL\033[0m  record lokal tanpa notes penjelas: {path}:{ln}")
                bad += 1

total = n_sepolia + n_local
# Printed unconditionally: the split is the finding, and burying it behind
# a PASS is exactly what Amandemen 4 exists to prevent.
print(f"  venue sepolia : {n_sepolia} record (wajib punya receipt)")
print(f"  venue local   : {n_local} record (diperiksa block_number+gas_used+notes)")
print(f"  E4 (uji forge): {n_e4} record (bukan transaksi chain, di luar D6)")
if total == 0:
    print("  \033[33mSKIP\033[0m  belum ada record L1")
elif bad == 0:
    print(f"  \033[32mPASS\033[0m  {total} record L1 lolos aturan venue-nya masing-masing")
sys.exit(1 if bad else 0)
PY
  [[ $? -eq 0 ]] || fail=$((fail+1))
fi

# ---------------------------------------------------------------- D7
hdr "D7  Kode dibekukan dan terhubung ke dataset"
if git rev-parse "$FREEZE_TAG" >/dev/null 2>&1; then
  ok "tag $FREEZE_TAG ada"
  tag_sha="$(git rev-list -n1 "$FREEZE_TAG")"
  man="$RAW/manifest.json"
  if [[ -f "$man" ]]; then
    man_sha="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("commit",""))' "$man")"
    if [[ "$man_sha" == "$tag_sha" ]]; then ok "manifest cocok dengan commit tag"
    else bad "manifest commit ($man_sha) != tag ($tag_sha) — dataset diukur dari kode lain"; fi
  else
    bad "manifest.json tidak ada di $RAW"
  fi
  if [[ "$RUN_ID_E3" != "$RUN_ID" ]]; then
    if [[ -z "$FREEZE_TAG_E3" ]]; then
      warn "dataset E3 terpisah ($RUN_ID_E3) tapi FREEZE_TAG_E3 belum diset — tag E3 belum bisa dicek"
    elif git rev-parse "$FREEZE_TAG_E3" >/dev/null 2>&1; then
      tag_sha_e3="$(git rev-list -n1 "$FREEZE_TAG_E3")"
      man_e3="$RAW_E3/manifest.json"
      if [[ -f "$man_e3" ]]; then
        man_sha_e3="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("commit",""))' "$man_e3")"
        if [[ "$man_sha_e3" == "$tag_sha_e3" ]]; then ok "manifest E3 cocok dengan commit $FREEZE_TAG_E3"
        else bad "manifest E3 ($man_sha_e3) != tag $FREEZE_TAG_E3 ($tag_sha_e3)"; fi
      else
        bad "manifest.json tidak ada di $RAW_E3"
      fi
    else
      bad "FREEZE_TAG_E3=$FREEZE_TAG_E3 diset tapi tag-nya tidak ada"
    fi
  fi
  if git diff --quiet "$FREEZE_TAG" -- contracts/src; then
    ok "contracts/src tidak berubah sejak tag"
  else
    bad "contracts/src berubah setelah tag — dataset tidak valid lagi"
  fi
else
  bad "tag $FREEZE_TAG belum dibuat (jalankan: make freeze)"
fi
if [[ -f ANALYSIS_PLAN.md ]]; then
  if git log -1 --format=%H -- ANALYSIS_PLAN.md >/dev/null 2>&1; then ok "ANALYSIS_PLAN.md ada dan ter-commit"; fi
else
  bad "ANALYSIS_PLAN.md tidak ada"
fi
if [[ -f "$DATA_ROOT/ZENODO_DOI.txt" ]]; then ok "DOI tercatat"; else warn "DOI belum ada (isi $DATA_ROOT/ZENODO_DOI.txt setelah rilis)"; fi

# ---------------------------------------------------------------- ringkas
hdr "Ringkasan"
printf '  pass=%d  fail=%d  skip=%d\n\n' "$pass" "$fail" "$skip"
[[ "$fail" -eq 0 ]] || exit 1
