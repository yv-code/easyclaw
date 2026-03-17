#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HASH="$(tr -d '[:space:]' < "$REPO_ROOT/.openclaw-version")"

# Parse flags
CLONE_ONLY=false
PROD=false
for arg in "$@"; do
  case "$arg" in
    --clone-only) CLONE_ONLY=true ;;
    --prod)       PROD=true ;;
  esac
done

echo "Setting up OpenClaw vendor @ $HASH"
git clone https://github.com/openclaw/openclaw.git "$REPO_ROOT/vendor/openclaw"
cd "$REPO_ROOT/vendor/openclaw"
git checkout -B main "$HASH"

if $CLONE_ONLY; then
  echo "OpenClaw vendor cloned ($HASH) — pristine state"
  exit 0
fi

# Use pnpm's default isolated linker (symlinks into .pnpm/).
# Previously used node-linker=hoisted to avoid Windows MAX_PATH issues,
# but this caused incomplete archives (hardlinks not fully copied by tar-fs)
# and missing dependencies on macOS/Windows CI builds.
pnpm install --no-frozen-lockfile
pnpm run build

if $PROD; then
  pnpm install --prod --no-frozen-lockfile
fi

rm -f .gitignore
echo "OpenClaw vendor ready ($HASH)"
