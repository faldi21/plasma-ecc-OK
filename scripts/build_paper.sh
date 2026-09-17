#!/usr/bin/env bash
#
# Compiles the paper against an IEEE Access template that lives OUTSIDE
# this repo and outside the system texmf tree.
#
# Why this script exists: ieeeaccess.cls and its Formata/Times Type-1
# fonts are not part of TeX Live, so a plain `pdflatex main_rev1.tex`
# fails first on the missing class and then, once the class is found, on
# ~1100 missing-TFM errors. Pointing four kpathsea variables at the
# template directory fixes both without installing anything system-wide
# and without copying template files into the paper repo:
#
#   TEXINPUTS  .cls .sty .fd      TFMFONTS  .tfm metrics
#   TEXFONTS   font lookup        T1FONTS   .pfb outlines
#
# Override the template location with IEEE_TEMPLATE_DIR.
#
# Usage:
#   bash scripts/build_paper.sh
#   IEEE_TEMPLATE_DIR=/path/to/template bash scripts/build_paper.sh
#   PAPER_TEX=main_rev2.tex bash scripts/build_paper.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$REPO_ROOT/.env.paper1" ]] && source "$REPO_ROOT/.env.paper1"

PAPER1_DIR="${PAPER1_DIR:-$HOME/paper1}"
# .env.paper1 sets PAPER_TEX as an ABSOLUTE path, but a caller may pass a
# bare filename. Accept both: anything containing "/" is used as-is, and
# PAPER1_DIR is re-derived from it so the two can never disagree.
PAPER_TEX="${PAPER_TEX:-main_rev1.tex}"
IEEE_TEMPLATE_DIR="${IEEE_TEMPLATE_DIR:-/home/faldi/PAPER-S3}"
PASSES="${PASSES:-3}"

if [[ ! -d "$IEEE_TEMPLATE_DIR" ]]; then
  echo "FATAL: direktori template tidak ada: $IEEE_TEMPLATE_DIR" >&2
  echo "       Set IEEE_TEMPLATE_DIR ke folder yang memuat ieeeaccess.cls" >&2
  echo "       beserta font t1-formata-*.tfm/.pfb dan t1-times*.tfm/.pfb." >&2
  exit 2
fi
if [[ ! -f "$IEEE_TEMPLATE_DIR/ieeeaccess.cls" ]]; then
  echo "FATAL: ieeeaccess.cls tidak ditemukan di $IEEE_TEMPLATE_DIR" >&2
  echo "       Skrip ini sengaja TIDAK memasang apa pun ke texmf sistem dan" >&2
  echo "       TIDAK menyalin berkas template ke $PAPER1_DIR." >&2
  echo "       Set IEEE_TEMPLATE_DIR ke folder template IEEE Access yang benar." >&2
  exit 2
fi
if [[ "$PAPER_TEX" == */* ]]; then
  PAPER1_DIR="$(cd "$(dirname "$PAPER_TEX")" 2>/dev/null && pwd)" || PAPER1_DIR=""
  PAPER_TEX="$(basename "$PAPER_TEX")"
fi
if [[ -z "$PAPER1_DIR" || ! -f "$PAPER1_DIR/$PAPER_TEX" ]]; then
  echo "FATAL: berkas .tex tidak ada: ${PAPER1_DIR:-<dir tidak ada>}/$PAPER_TEX" >&2
  exit 2
fi

# Missing font METRICS are not fatal to pdflatex -- it substitutes and
# carries on -- so a build can "succeed" with garbled output. Warn loudly
# instead of silently producing that.
if ! ls "$IEEE_TEMPLATE_DIR"/t1-formata-regular.tfm >/dev/null 2>&1; then
  echo "PERINGATAN: ieeeaccess.cls ada tapi font t1-formata-*.tfm tidak;" >&2
  echo "            hasilnya akan penuh substitusi font." >&2
fi

# Trailing "//" = search recursively; trailing ":" = also keep the
# default TeX Live paths, so this ADDS the template dir rather than
# replacing the system tree.
export TEXINPUTS=".:${IEEE_TEMPLATE_DIR}//:"
export TEXFONTS=".:${IEEE_TEMPLATE_DIR}//:"
export TFMFONTS=".:${IEEE_TEMPLATE_DIR}//:"
export T1FONTS=".:${IEEE_TEMPLATE_DIR}//:"
export BSTINPUTS=".:${IEEE_TEMPLATE_DIR}//:"
export BIBINPUTS=".:${IEEE_TEMPLATE_DIR}//:"

base="${PAPER_TEX%.tex}"
cd "$PAPER1_DIR" || exit 2
echo "[build_paper] $PAPER1_DIR/$PAPER_TEX  (template: $IEEE_TEMPLATE_DIR)"

for i in $(seq 1 "$PASSES"); do
  pdflatex -interaction=nonstopmode "$PAPER_TEX" >/dev/null 2>&1
done

if [[ ! -f "$base.log" ]]; then
  echo "FATAL: pdflatex tidak menghasilkan $base.log" >&2
  exit 1
fi

python3 - "$base.log" <<'PY'
import re, sys
log = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
errors = [l for l in log if l.startswith("! ")]
refs = [l for l in log if re.match(r"LaTeX Warning: (Citation|Reference)", l)]
fonts = [l for l in log if "Font Warning" in l]
out = [l for l in log if "Output written" in l]
print(f"  error            : {len(errors)}")
for l in errors[:10]:
    print("     ", l)
print(f"  citation/ref undef: {len(refs)}")
for l in refs[:5]:
    print("     ", l)
print(f"  font warning      : {len(fonts)} (substitusi, tidak fatal)")
print("  " + (out[0] if out else "TIDAK ADA PDF"))
sys.exit(1 if errors or not out else 0)
PY
status=$?
[[ "$status" -eq 0 ]] && echo "[build_paper] OK" || echo "[build_paper] GAGAL" >&2
exit "$status"
