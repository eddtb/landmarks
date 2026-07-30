#!/usr/bin/env bash
#
# Refuse to publish an OTA that cannot arrive.
#
# An `eas update` always succeeds. Whether any phone RECEIVES it depends
# on the runtime version it was published against matching a binary that
# exists — and nothing tells you when it doesn't. A published update
# nobody can receive looks exactly like a published update everybody got.
#
# Three ways that goes wrong, all of them seen:
#
#   1. A dirty app.json. `eas update` writes to it when a platform lacks
#      a runtimeVersion policy, re-serialising the config AFTER plugins
#      run — duplicating permissions and the location background mode.
#      The fingerprint changes, so the update targets nothing.
#   2. A native change since the last build. Correct behaviour: the
#      fingerprint moved and old binaries stop being offered the update.
#      The answer is a new build, NEVER a looser runtimeVersion policy.
#   3. An untested bundle. An OTA reaches phones with no review in
#      between, so it carries the same bar as a build.
#
# Usage: scripts/preflight-ota.sh [channel]   (default: production)

set -euo pipefail

CHANNEL="${1:-production}"
PLATFORM="${PLATFORM:-ios}"

fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }

printf '\nOTA preflight — channel: %s, platform: %s\n\n' "$CHANNEL" "$PLATFORM"

# 1. A clean tree, because app.json is load-bearing and tooling writes to it
if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short
  fail "Working tree is dirty. Commit or revert first — an uncommitted app.json
  silently changes the fingerprint, and the update goes nowhere."
fi
ok "working tree clean"

# 2. The same bar as a build, because there is no review between here and a phone
npx tsc --noEmit || fail "typecheck failed"
ok "typecheck"
npm run --silent lint >/dev/null || fail "lint failed"
ok "lint"
npx jest --silent >/dev/null 2>&1 || fail "tests failed"
ok "tests"

# 3. The fingerprint has to match a binary that actually exists
FINGERPRINT="$(npx eas-cli fingerprint:generate --platform "$PLATFORM" --environment "$CHANNEL" 2>/dev/null \
  | grep -oE '[0-9a-f]{40}' | head -1)"
[ -n "$FINGERPRINT" ] || fail "could not compute the project fingerprint"
ok "fingerprint $FINGERPRINT"

RUNTIMES="$(npx eas-cli build:list --channel "$CHANNEL" --platform "$PLATFORM" \
  --status finished --limit 10 --json --non-interactive 2>/dev/null \
  | grep -oE '[0-9a-f]{40}' | sort -u || true)"

if [ -z "$RUNTIMES" ]; then
  fail "No finished $PLATFORM builds found on channel '$CHANNEL', so there is
  nothing for an update to reach. Build first."
fi

if ! printf '%s\n' "$RUNTIMES" | grep -qx "$FINGERPRINT"; then
  printf '\nRuntime versions of finished builds on %s:\n' "$CHANNEL"
  printf '  %s\n' $RUNTIMES
  fail "The fingerprint matches NO build on '$CHANNEL'. Something native has
  changed since those binaries were made, so an update published now
  would be offered to nobody.

  The answer is a new build — never a looser runtimeVersion policy."
fi

ok "a finished build on '$CHANNEL' runs this exact fingerprint"
printf '\n\033[32mPreflight passed.\033[0m Publish with:\n  npx eas-cli update --branch %s --environment %s\n\n' "$CHANNEL" "$CHANNEL"
