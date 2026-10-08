#!/bin/bash
# Builds menubar/build/FleetBar.app with swiftc.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p build
module_cache=$(mktemp -d "${TMPDIR:-/tmp}/fleetbar-swift.XXXXXX")
trap 'rm -rf "$module_cache"' EXIT
swiftc -O -module-cache-path "$module_cache" FleetBar.swift -o build/FleetBar
mkdir -p build/FleetBar.app/Contents/MacOS
cp build/FleetBar build/FleetBar.app/Contents/MacOS/FleetBar
cp Info.plist build/FleetBar.app/Contents/Info.plist
echo "Built menubar/build/FleetBar.app"
