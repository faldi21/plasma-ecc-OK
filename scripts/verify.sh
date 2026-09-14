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

printf '\n\033[1mverify\033[0m  RUN_ID=%s\n  paper: %s\n  data : %s\n' "$RUN_ID" "$PAPER_TEX" "$RAW"

# ---------------------------------------------------------------- D1
hdr "D1  Semua \\fillin{} sudah terisi"
if [[ -f "$PAPER_TEX" ]]; then
  n_fill=$(grep -c '\\fillin' "$PAPER_TEX" || true)
  n_todo=$(grep -c '\\todo'   "$PAPER_TEX" || true)
  if [[ "$n_fill" -eq 0 ]]; then ok "tidak ada \\fillin tersisa"
  else bad "$n_fill penanda \\fillin masih ada di $PAPER_TEX"; fi
  if [[ "$n_todo" -eq 0 ]]; then ok "tidak ada \\todo tersisa"
  else bad "$n_todo penanda \\todo masih ada (teks interpretasi belum ditulis)"; fi
else
  warn "paper tidak ditemukan di $PAPER_TEX (set PAPER_TEX=...)"
fi

# ---------------------------------------------------------------- D2
hdr "D2  Tabel dan gambar bisa digenerate ulang secara identik"
if command -v python3 >/dev/null && [[ -d "$PROC" ]]; then
  tmp="$(mktemp -d)"
  if python3 analysis/make_tables.py --run-id "$RUN_ID" --data "$DATA_ROOT" --out "$tmp" >/dev/null 2>&1; then
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
  files=$(find "$RAW" -name '*.jsonl' | wc -l)
  if [[ "$files" -gt 0 ]]; then
    ok "$files berkas JSONL di $RAW"
    python3 - "$RAW" "$MIN_N" "$MIN_N_L1" <<'PY'
import glob, json, sys, collections
raw, min_n, min_n_l1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
cells = collections.Counter(); layers = {}; bad = 0
for path in glob.glob(f"{raw}/*.jsonl"):
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
  if find "$RAW" -name '*.jsonl' -perm -u+w | grep -q .; then
    bad "data mentah masih writable — jalankan: chmod -w $RAW/*.jsonl"
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
hdr "D6  Semua angka L1 punya receipt yang bisa ditelusuri"
if [[ -d "$RAW" ]]; then
  python3 - "$RAW" "$RECEIPTS" <<'PY'
import glob, json, os, re, sys
raw, rcp = sys.argv[1], sys.argv[2]
pat = re.compile(r"^0x[0-9a-fA-F]{64}$"); bad = 0; n = 0
for path in glob.glob(f"{raw}/*.jsonl"):
    for ln, line in enumerate(open(path), 1):
        line = line.strip()
        if not line: continue
        rec = json.loads(line)
        if rec.get("layer") != "L1": continue
        # E4 (bench/e4_exploits.ts) records are Foundry test executions,
        # not real network transactions -- layer="L1" there means "this
        # test exercises L1 contract logic", not "this is a traceable
        # Sepolia tx". They never have a real tx_hash and are not what D6
        # is checking for (caught testing this script: every real
        # campaign's e4_exploits.jsonl would otherwise fail D6 forever).
        if str(rec.get("cell_id", "")).startswith("e4."): continue
        n += 1
        h = rec.get("tx_hash")
        if not h or not pat.match(h):
            print(f"  \033[31mFAIL\033[0m  record L1 tanpa tx_hash sah: {path}:{ln}"); bad += 1; continue
        if os.path.isdir(rcp) and not os.path.exists(os.path.join(rcp, h + ".json")):
            print(f"  \033[31mFAIL\033[0m  receipt hilang untuk {h}"); bad += 1
if n == 0: print("  \033[33mSKIP\033[0m  belum ada record L1")
elif bad == 0: print(f"  \033[32mPASS\033[0m  {n} record L1, semua punya tx_hash dan receipt")
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
