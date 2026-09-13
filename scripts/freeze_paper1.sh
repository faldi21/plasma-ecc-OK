#!/usr/bin/env bash
# Bekukan kode dan buat RUN_ID baru.
set -euo pipefail
source .env.paper1
TAG="${FREEZE_TAG:-paper1-rev1-frozen}"

git diff --quiet || { echo "Working tree kotor. Commit dulu."; exit 1; }
git rev-parse "$TAG" >/dev/null 2>&1 || git tag -a "$TAG" -m "frozen for Paper 1 measurement campaign"

RUN_ID="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
OUT="$DATA_ROOT/raw/$RUN_ID"
mkdir -p "$OUT"

python3 - "$OUT/manifest.json" <<'PY'
import json, platform, subprocess, sys, hashlib, os
def sh(c):
    try: return subprocess.check_output(c, shell=True, text=True).strip()
    except Exception: return None
def h(p):
    return hashlib.sha256(open(p,'rb').read()).hexdigest() if os.path.exists(p) else None
json.dump({
  "commit": sh("git rev-parse HEAD"),
  "tag": sh("git describe --tags --exact-match 2>/dev/null") or sh("git describe --tags"),
  "created_at": sh("date -Is"),
  "os": platform.platform(),
  "cpu": sh("lscpu | grep 'Model name' | sed 's/.*: *//'"),
  "ram_gb": sh("free -g | awk '/Mem:/{print $2}'"),
  "anvil": sh("anvil --version"),
  "forge": sh("forge --version"),
  "node": sh("node --version"),
  "python": sys.version.split()[0],
  "foundry_toml_sha256": h("foundry.toml"),
  "package_lock_sha256": h("package-lock.json"),
  "load_avg": sh("uptime"),
}, open(sys.argv[1], "w"), indent=2)
PY

echo "$RUN_ID" > "$DATA_ROOT/LATEST"
echo "RUN_ID=$RUN_ID"
echo "manifest: $OUT/manifest.json"
