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
if ! curl -sf -o /dev/null http://localhost:8081/status; then
  echo "✗ Metro isn't running on :8081. Start it: npx expo start" >&2
  exit 1
fi

# Greenwich: the project's home turf — caches are warm here
xcrun simctl location booted set 51.4826,-0.0077

maestro test .maestro/
