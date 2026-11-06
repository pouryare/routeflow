#!/usr/bin/env bash
# Packs a built app (after `next build`) into one release tarball per machine type:
#
#   scripts/release/pack.sh x64      # -> dist/routeflow-<version>-linux-x64.tar.gz (+ .sha256)
#   scripts/release/pack.sh arm64    # -> dist/routeflow-<version>-linux-arm64.tar.gz (+ .sha256)
#
# The built code is the same for both; only Node itself and sharp's image library differ, so one
# `next build` serves every machine type. The tarball carries its own Node, so the server needs
# none from apt, and nothing is downloaded during an install or upgrade (deploy/routeflow).
#
# Layout inside routeflow-<version>-linux-<arch>/:
#   server.js .next/ node_modules/   the app (Next standalone output), started by its own node
#   public/ content/ data/           files the app reads at run time (data/ = committed files only)
#   node/bin/node                    the Node it was built and tested with
#   db/migrations db/server scripts/ the migrations and server scripts (backup, doctor, users)
#   tools/node_modules/              node-pg-migrate and pg, for the migrations
#   bin/routeflow                    the server command
#   VERSION ARCH NODE_VERSION

set -euo pipefail

ARCH=${1:?usage: pack.sh x64|arm64}
case "$ARCH" in x64 | arm64) ;; *) echo "arch must be x64 or arm64" >&2; exit 2 ;; esac
cd "$(dirname "$0")/../.."
[ -f .next/standalone/server.js ] || { echo "run next build first (output: standalone)" >&2; exit 1; }

VERSION=$(node -p 'require("./package.json").version')
NODE_VERSION=${NODE_VERSION:-$(node -p 'process.versions.node')}
lockv() { node -p "require('./package-lock.json').packages['node_modules/$1'].version"; }
NAME=routeflow-$VERSION-linux-$ARCH
OUT=dist/$NAME
rm -rf "$OUT" "dist/$NAME.tar.gz" "dist/$NAME.tar.gz.sha256"
mkdir -p "$OUT"

# The app. Only server.js, .next and node_modules are taken from standalone: dynamic file reads make
# Next trace the whole project, which would also copy sources, docs, tests and any local data.
cp -a .next/standalone/server.js .next/standalone/package.json .next/standalone/.next .next/standalone/node_modules "$OUT/"
cp -a .next/static "$OUT/.next/static"
# Playwright reads its own data files at run time, which the trace misses (lead import); ship it whole.
rm -rf "$OUT/node_modules/playwright" "$OUT/node_modules/playwright-core"
cp -a node_modules/playwright node_modules/playwright-core "$OUT/node_modules/"
# Committed files only, so a developer's local photos or database can never end up in a release.
git archive HEAD public content data db/migrations db/server \
  scripts/pg scripts/_db.mjs scripts/create-user.mjs scripts/disable-second-factor.mjs scripts/reset-login.mjs scripts/run-sweeps.mjs \
  | tar -x -C "$OUT"
install -D -m 755 deploy/routeflow "$OUT/bin/routeflow"
install -D -m 755 deploy/monitor/routeflow-monitor "$OUT/bin/routeflow-monitor"

# sharp is the one native module the app loads; swap in the build for the target machine.
if [ "$ARCH" != "$(node -p 'process.arch')" ]; then
  tmp=$(mktemp -d)
  npm install --prefix "$tmp" --no-save --no-audit --no-fund --os=linux --cpu="$ARCH" --libc=glibc "sharp@$(lockv sharp)" >/dev/null
  rm -rf "$OUT"/node_modules/@img/sharp-linux* "$OUT"/node_modules/@img/sharp-libvips-linux*
  cp -a "$tmp"/node_modules/@img/sharp-linux-"$ARCH" "$tmp"/node_modules/@img/sharp-libvips-linux-"$ARCH" "$OUT/node_modules/@img/"
  rm -rf "$tmp"
fi
[ -d "$OUT/node_modules/@img/sharp-linux-$ARCH" ] || { echo "sharp for linux-$ARCH is missing" >&2; exit 1; }

# The migration runner, pinned to the versions in package-lock.json.
mkdir -p "$OUT/tools"
echo '{"private":true}' > "$OUT/tools/package.json"
npm install --prefix "$OUT/tools" --no-save --no-audit --no-fund --omit=dev \
  "node-pg-migrate@$(lockv node-pg-migrate)" "pg@$(lockv pg)" >/dev/null

# Node itself, checked against nodejs.org's published sums.
NODE_DIST=https://nodejs.org/dist/v$NODE_VERSION
NODE_TAR=node-v$NODE_VERSION-linux-$ARCH.tar.xz
CACHE=${NODE_CACHE:-.cache/node}
mkdir -p "$CACHE"
[ -f "$CACHE/$NODE_TAR" ] || curl -fsSL "$NODE_DIST/$NODE_TAR" -o "$CACHE/$NODE_TAR"
curl -fsSL "$NODE_DIST/SHASUMS256.txt" | grep " $NODE_TAR\$" | (cd "$CACHE" && sha256sum -c --quiet -)
mkdir -p "$OUT/node/bin"
tar -xJf "$CACHE/$NODE_TAR" -C "$OUT/node/bin" --strip-components=2 "node-v$NODE_VERSION-linux-$ARCH/bin/node"

echo "$VERSION" > "$OUT/VERSION"
echo "$ARCH" > "$OUT/ARCH"
echo "$NODE_VERSION" > "$OUT/NODE_VERSION"

tar -czf "dist/$NAME.tar.gz" -C dist "$NAME"
(cd dist && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
rm -rf "$OUT"
echo "dist/$NAME.tar.gz ($(du -h "dist/$NAME.tar.gz" | cut -f1))"
