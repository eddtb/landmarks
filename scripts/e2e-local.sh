#!/usr/bin/env bash
# Run the Maestro smoke flow against the local simulator.
#
# Expects: a booted iOS simulator with the dev build installed
# (npx expo run:ios), Metro running (npx expo start), and the
# maestro CLI on PATH. Pins the simulator to Greenwich so Nearby
# has stories and the REPLAY_ONLY caches hit.

set -euo pipefail
cd "$(dirname "$0")/.."

# Brew's maestro formula isn't always linked (the Studio cask shadows
# the name), and maestro needs a JRE that macOS doesn't ship.
if ! command -v maestro > /dev/null && [ -x /opt/homebrew/opt/maestro/bin/maestro ]; then
  export PATH="$PATH:/opt/homebrew/opt/maestro/bin"
fi
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk
  export PATH="$JAVA_HOME/bin:$PATH"
fi

if ! xcrun simctl list devices booted | grep -q Booted; then
  echo "✗ No booted simulator. Start one (or: npx expo run:ios)" >&2
  exit 1
fi
# Which Metro to drive — default 8081 (the main checkout's server).
# Worktree sessions run their own Metro on 8084+ and pass it in:
#   METRO_PORT=8084 scripts/e2e-local.sh
METRO_PORT="${METRO_PORT:-8081}"
if ! curl -sf -o /dev/null "http://localhost:${METRO_PORT}/status"; then
  echo "✗ Metro isn't running on :${METRO_PORT}. Start it: npx expo start" >&2
  exit 1
fi

# Greenwich: the project's home turf — caches are warm here
xcrun simctl location booted set 51.4826,-0.0077

# Maestro leaves its XCUITest driver host (an `xcodebuild
# test-without-building` process) running after the suite ends; the
# NEXT invocation's fresh driver then fights the stale one and dies
# ~20s in ("Transport unreachable… Restarting after unexpected
# exit") — observed as perfectly alternating green/dead runs. Kill
# leftovers (and the sim-side runner) so every run starts clean.
pkill -f "maestro-driver-ios-config.xctestrun" 2> /dev/null || true
xcrun simctl terminate booted dev.mobile.maestro-driver-iosUITests.xctrunner 2> /dev/null || true

# METRO_URL rides into every flow (URL-encoded origin for the
# dev-client link and the outage scripts); flows default it to 8081
# for CI, so only a non-default port needs the override
maestro test -e METRO_URL="http%3A%2F%2Flocalhost%3A${METRO_PORT}" .maestro/
