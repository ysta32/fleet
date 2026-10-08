#!/usr/bin/env bash
# One-command Fleet installer. Safe to rerun. Never touches ~/.claude/settings.json.
#
#   FLEET_FROM=/path/to/checkout  build and install from a local checkout
#   FLEET_FROM_GIT=1              clone (or update) FLEET_REPO_URL into FLEET_SRC_DIR, then build
#   FLEET_PACKAGE=<spec>          npm package, tarball path or URL (default: fleet-collector)
#   FLEET_PREFIX=<dir>            npm prefix for the install (default: npm's global prefix)
#   FLEET_NO_LAUNCHD=1            write the launchd plist but do not load it
set -euo pipefail

REPO_URL="${FLEET_REPO_URL:-https://github.com/ysta32/fleet.git}"
SRC_DIR="${FLEET_SRC_DIR:-$HOME/.fleet/src}"
PACKAGE="${FLEET_PACKAGE:-fleet-collector}"
PREFIX="${FLEET_PREFIX:-}"

fail() {
  echo "fail  $1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node is not installed. Install Node 20 or newer, then rerun."
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  fail "Node $(node -v) is older than 20. Install Node 20 or newer, then rerun."
fi
command -v npm >/dev/null 2>&1 || fail "npm is not on PATH. Install npm alongside Node, then rerun."

npm_global=(npm install -g --no-audit --no-fund)
if [ -n "$PREFIX" ]; then
  npm_global+=(--prefix "$PREFIX")
fi

build_checkout() {
  local dir="$1"
  local fresh_deps="${2:-0}"
  [ -f "$dir/packages/collector/package.json" ] || fail "$dir is not a Fleet checkout. Point FLEET_FROM at the repo root."
  cd "$dir"
  # a cloned checkout may have changed, so always sync its dependencies; a local checkout keeps its own
  if [ "$fresh_deps" = "1" ] || [ ! -d node_modules ]; then
    npm ci --no-audit --no-fund
  fi
  npm run build --workspaces --if-present
  "${npm_global[@]}" "$dir/packages/collector"
}

if [ -n "${FLEET_FROM:-}" ]; then
  build_checkout "$(cd "$FLEET_FROM" && pwd)"
elif [ "${FLEET_FROM_GIT:-0}" = "1" ]; then
  command -v git >/dev/null 2>&1 || fail "git is not installed. Install git or use the npm package."
  if [ -d "$SRC_DIR/.git" ]; then
    git -C "$SRC_DIR" pull --ff-only
  else
    mkdir -p "$(dirname "$SRC_DIR")"
    git clone --depth 1 "$REPO_URL" "$SRC_DIR"
  fi
  build_checkout "$SRC_DIR" 1
else
  "${npm_global[@]}" "$PACKAGE"
fi

if [ -n "$PREFIX" ]; then
  fleet_bin="$PREFIX/bin/fleet"
else
  fleet_bin="$(command -v fleet || true)"
fi
[ -x "${fleet_bin:-}" ] || fail "The fleet command was not found after install. Add npm's global bin directory to PATH."

"$fleet_bin" install
port="$("$fleet_bin" token | sed -n '2p' | sed -E 's#^http://[^:]+:([0-9]+)/.*#\1#')"
echo
echo "ok    Fleet is installed. Open http://127.0.0.1:${port:-4747}/ in your browser."
echo "      Run fleet token for the access token and LAN URL, and fleet doctor to check your setup."
