#!/usr/bin/env bash
# One-command Fleet installer. Safe to rerun. Never touches ~/.claude/settings.json.
#
#   FLEET_FROM=/path/to/checkout  build and install from a local checkout
#   (default)                     clone (or update) FLEET_REPO_URL into FLEET_SRC_DIR, then build
#   FLEET_PACKAGE=<spec>          install this npm package, tarball path or URL instead (opt-in;
#                                 the fleet-collector package is not published yet)
#   FLEET_PREFIX=<dir>            npm prefix for the install (default: npm's global prefix)
#   FLEET_NO_LAUNCHD=1            write the launchd plist but do not load it
set -euo pipefail

main() {
  REPO_URL="${FLEET_REPO_URL:-https://github.com/ysta32/fleet.git}"
  SRC_DIR="${FLEET_SRC_DIR:-$HOME/.fleet/src}"
  PACKAGE="${FLEET_PACKAGE:-}"
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
    # workspace order builds the collector before web; recopy so the shipped dashboard is current
    npm run copy-web --workspace fleet-collector
    "${npm_global[@]}" "$dir/packages/collector"
  }

  if [ -n "${FLEET_FROM:-}" ]; then
    build_checkout "$(cd "$FLEET_FROM" && pwd)"
  elif [ -n "$PACKAGE" ]; then
    "${npm_global[@]}" "$PACKAGE"
  else
    command -v git >/dev/null 2>&1 || fail "git is not installed. Install git, or set FLEET_PACKAGE to an npm package."
    if [ -d "$SRC_DIR/.git" ]; then
      git -C "$SRC_DIR" pull --ff-only
    else
      mkdir -p "$(dirname "$SRC_DIR")"
      git clone --depth 1 "$REPO_URL" "$SRC_DIR"
    fi
    build_checkout "$SRC_DIR" 1
  fi

  if [ -n "$PREFIX" ]; then
    fleet_bin="$PREFIX/bin/fleet"
  else
    fleet_bin="$(command -v fleet || true)"
  fi
  [ -x "${fleet_bin:-}" ] || fail "The fleet command was not found after install. Add npm's global bin directory to PATH."

  "$fleet_bin" install
  port="$("$fleet_bin" token | grep -m1 '^http://' | sed -E 's#^http://[^:]+:([0-9]+)/.*#\1#' || true)"
  echo
  echo "ok    Fleet is installed. Open http://127.0.0.1:${port:-4747}/ in your browser."
  echo "      Run fleet token for the access token and LAN URL, and fleet doctor to check your setup."
}

main "$@"
