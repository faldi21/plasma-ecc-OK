#!/usr/bin/env bash
# Backward-compatible wrapper: the D1-D7 check now lives at
# scripts/verify.sh (docs/TICKETS.md T9, matching CLAUDE.md's "Perintah"
# section canonical path). Kept so any existing muscle-memory/references
# to this filename keep working -- forwards every arg/env var unchanged.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/verify.sh" "$@"
