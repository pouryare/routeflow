#!/usr/bin/env bash
# Run a build (or any memory-hungry command) with temporary swap.
#
# This box has 3.9GB of RAM and no swap. The VS Code server alone holds ~1.3GB, so
# `next build` gets OOM-killed with about 1.1GB free -- and capping the Node heap does
# not help, because Turbopack's build is native and does not allocate on the V8 heap.
#
# The swap file is created, used and removed again by this script. Nothing is left
# behind and /etc/fstab is not touched, so a reboot cannot inherit a stale swap file.
#
#   scripts/build-with-swap.sh                # runs npm run build
#   scripts/build-with-swap.sh npm test       # or anything else
#
set -euo pipefail

SWAPFILE=${SWAPFILE:-/swapfile-build}
SIZE_MB=${SIZE_MB:-2048}

cleanup() {
  if swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAPFILE"; then
    echo "→ removing temporary swap"
    swapoff "$SWAPFILE" || true
  fi
  rm -f "$SWAPFILE"
}
# Runs on success, on failure, and on Ctrl-C alike: leaving a multi-gigabyte file
# behind on a disk this size is a worse outcome than a failed build.
trap cleanup EXIT INT TERM

if [ -e "$SWAPFILE" ]; then
  echo "✗ $SWAPFILE already exists -- refusing to overwrite it" >&2
  exit 1
fi

echo "→ creating ${SIZE_MB}MB temporary swap at $SWAPFILE"
if ! fallocate -l "${SIZE_MB}M" "$SWAPFILE" 2>/dev/null; then
  # fallocate can leave holes that mkswap refuses; dd always produces a usable file.
  dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SIZE_MB" status=none
fi
chmod 600 "$SWAPFILE"
mkswap "$SWAPFILE" >/dev/null
swapon "$SWAPFILE"
free -m | sed -n '1p;3p'

if [ "$#" -eq 0 ]; then
  set -- npm run build
fi

echo "→ $*"
"$@"
