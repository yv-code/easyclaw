#!/usr/bin/env bash
# =============================================================================
# fix-vendor-hardlinks.sh — Break hardlinks in vendor/openclaw/extensions
#
# pnpm installs "file:vendor/openclaw" by hardlinking files into the store.
# This gives vendor extension files nlink=2, which OpenClaw's rejectHardlinks
# security check rejects as "unsafe plugin manifest path".
#
# This script copies each affected file to itself, breaking the hardlink
# so nlink returns to 1.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$REPO_ROOT/vendor/openclaw/extensions"

if [ ! -d "$EXT_DIR" ]; then
  exit 0
fi

count=0
for f in "$EXT_DIR"/*/openclaw.plugin.json "$EXT_DIR"/*/index.ts "$EXT_DIR"/*/package.json; do
  [ -f "$f" ] || continue
  # stat -c works on Linux/MSYS2(Git Bash), stat -f on macOS
  if stat -c '%h' "$f" >/dev/null 2>&1; then
    nlink=$(stat -c '%h' "$f")
  else
    nlink=$(stat -f '%l' "$f")
  fi
  if [ "$nlink" -gt 1 ]; then
    cp "$f" "$f.tmp" && mv "$f.tmp" "$f"
    count=$((count + 1))
  fi
done

if [ "$count" -gt 0 ]; then
  echo "==> Fixed $count vendor extension hardlink(s)"
fi
