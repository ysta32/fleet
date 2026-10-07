#!/usr/bin/env bash
# One-command Fleet installer. Never touches ~/.claude/settings.json.
set -euo pipefail

REPO_URL="${FLEET_REPO_URL:-https://github.com/ysta32/fleet.git}"
SRC_DIR="${FLEET_SRC_DIR:-$HOME/.fleet/src}"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node >= 20 is required" >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "error: node >= 20 required (found $(node -v))" >&2
  exit 1
fi

if [ "${FLEET_FROM_GIT:-0}" = "1" ]; then
  command -v git >/dev/null 2>&1 || { echo "error: git is required" >&2; exit 1; }
  if [ -d "$SRC_DIR/.git" ]; then
    git -C "$SRC_DIR" pull --ff-only
  else
    mkdir -p "$(dirname "$SRC_DIR")"
    git clone --depth 1 "$REPO_URL" "$SRC_DIR"
  fi
  (cd "$SRC_DIR" && npm ci && npm run build --workspaces --if-present && cd packages/collector && npm link)
else
  npm i -g fleet-collector
fi

fleet install
port="$(fleet token | sed -n '2p' | sed -E 's#^http://[^:]+:([0-9]+)/.*#\1#')"
echo
echo "Fleet is running: http://127.0.0.1:${port:-4747}/"
echo "Run 'fleet token' for the LAN URL, 'fleet doctor' to check your setup."
