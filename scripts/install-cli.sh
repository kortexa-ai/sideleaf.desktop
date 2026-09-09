#!/bin/sh
set -eu
# Install the standalone npm archive on macOS or inside a WSL distribution.
# npm owns command creation, upgrades and removal; no copied stale wrapper.
if [ "$#" -ne 1 ]; then echo 'Usage: sh install-cli.sh /path/to/sideleaf-desktop-VERSION.tgz' >&2; exit 2; fi
node -e 'if (+process.versions.node.split(".")[0] < 24) process.exit(1)' || { echo 'Install Node.js 24+ and npm first.' >&2; exit 2; }
exec npm install --global "$1"
