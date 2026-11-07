#!/usr/bin/env bash
# Put this next to routeflow-<version>-linux-<arch>.tar.gz (and its .sha256) on the new server, then:
#   sudo bash install.sh
# It checks the file against its checksum, unpacks it and starts the install questions.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64 | arm64) arch=arm64 ;; *) echo "unsupported machine: $(uname -m)" >&2; exit 1 ;; esac
t=$(ls -1 routeflow-*-linux-"$arch".tar.gz 2>/dev/null | sort -V | tail -1 || true)
[ -n "$t" ] || { echo "no routeflow-*-linux-$arch.tar.gz next to this script" >&2; exit 1; }
if [ -f "$t.sha256" ]; then sha256sum -c "$t.sha256"; else echo "no $t.sha256 next to it: the checksum was not checked" >&2; fi
[ "$(id -u)" = 0 ] || { echo "run it with sudo:  sudo bash install.sh" >&2; exit 1; }
tar -xzf "$t"
exec bash "${t%.tar.gz}/bin/routeflow" install "$t"
