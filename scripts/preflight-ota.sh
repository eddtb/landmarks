#!/usr/bin/env bash
#
# Refuse to publish an OTA that cannot arrive.
#
# An `eas update` always succeeds. Whether any phone RECEIVES it depends
# on the runtime version it was published against matching a binary that
# exists — and nothing tells you when it doesn't. A published update
# nobody can receive looks exactly like a published update everybody got.
#
# Four ways that goes wrong, all of them seen:
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
#   4. An unreviewed branch. Nothing about a feature branch stops it
#      publishing to production, and there is no review after this point
#      to catch it — so the commit has to be one the reviewed line
#      already contains.
#
# Every check fails CLOSED. "I could not find out" is never treated as
# "everything is fine", and it is never reported as its opposite either:
# an unauthenticated CLI reads very differently from an empty account,
# and answering the first with "build first" costs half an hour.
#
# Usage: scripts/preflight-ota.sh [channel]   (default: production)
#
# Env:
#   PLATFORM           ios (default) | android
#   PREFLIGHT_BASE_REF the reviewed line, as a branch on origin.
#                      Defaults to origin's default branch.

set -euo pipefail

CHANNEL="${1:-production}"
PLATFORM="${PLATFORM:-ios}"

fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }

CLI_ERR="$(mktemp)"
trap 'rm -f "$CLI_ERR"' EXIT
show_cli_error() { sed 's/^/  │ /' "$CLI_ERR" >&2; }

printf '\nOTA preflight — channel: %s, platform: %s\n\n' "$CHANNEL" "$PLATFORM"

# 1. A clean tree, because app.json is load-bearing and tooling writes to it.
#    --porcelain and not `git diff`, which sees neither side of the worst
#    case: an UNTRACKED app.config.js overrides app.json wholesale, and
#    untracked sources get bundled into the update either way.
DIRT="$(git status --porcelain)" || fail "git status failed — not a work tree?"
if [ -n "$DIRT" ]; then
  printf '%s\n' "$DIRT"
  fail "Working tree is dirty. Commit or revert first — an uncommitted app.json
  silently changes the fingerprint, and the update goes nowhere. An
  untracked app.config.js replaces app.json outright."
fi
ok "working tree clean (tracked and untracked)"

# 2. The commit has to be one the reviewed line already contains.
#    The target is a branch on ORIGIN, never a local ref: the point is
#    that other people have seen this code, and a local branch proves
#    only that this machine has.
BASE_REF="${PREFLIGHT_BASE_REF:-}"
if [ -z "$BASE_REF" ]; then
  BASE_REF="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD || true)"
  [ -n "$BASE_REF" ] || fail "Cannot tell which branch is the reviewed line: origin has no
  recorded default. Fix it with 'git remote set-head origin -a', or name
  the line yourself with PREFLIGHT_BASE_REF."
fi
case "$BASE_REF" in
  origin/*) ;;
  *) fail "PREFLIGHT_BASE_REF must name a branch on origin (e.g. origin/main).
  A local ref would only prove this machine has the commit." ;;
esac

# A stale remote-tracking ref would make the ancestry check meaningless —
# it would compare against whatever origin looked like last time.
git fetch --quiet origin 2>"$CLI_ERR" || {
  show_cli_error
  fail "Could not fetch from origin, so '$BASE_REF' may be stale and the
  check below would be measuring nothing."
}
git rev-parse --verify --quiet "refs/remotes/$BASE_REF" >/dev/null \
  || fail "'$BASE_REF' does not exist on origin."

if ! git merge-base --is-ancestor HEAD "refs/remotes/$BASE_REF"; then
  AHEAD="$(git rev-list --count "refs/remotes/$BASE_REF..HEAD")"
  fail "HEAD is $AHEAD commit(s) that '$BASE_REF' does not contain, and an OTA
  has no review after it — publishing now ships unreviewed code to every
  phone on '$CHANNEL'.

  Land them first. If this repository is deliberately shipping from an
  integration branch, say which one:

    PREFLIGHT_BASE_REF=origin/<branch> scripts/preflight-ota.sh $CHANNEL

  which is a deliberate declaration that THAT branch is the reviewed line."
fi
ok "HEAD is contained in $BASE_REF"

# 3. The same bar as a build, because there is no review between here and
#    a phone. --max-warnings 0 to match ci.yml and the pre-push hook: the
#    check with nothing after it must not be the loosest of the three.
npx tsc --noEmit || fail "typecheck failed"
ok "typecheck"
npm run --silent lint -- --max-warnings 0 >/dev/null || fail "lint failed"
ok "lint"
npx jest --silent >/dev/null 2>&1 || fail "tests failed"
ok "tests"

# 4. The fingerprint has to match a binary that actually exists.
#    Read the field out of --json rather than grepping for 40 hex chars:
#    a fingerprint, a commit SHA and a build id are all the same shape,
#    and a guardrail that can match the wrong one waves a broken update
#    through.
FINGERPRINT_JSON="$(npx eas-cli fingerprint:generate --platform "$PLATFORM" \
  --environment "$CHANNEL" --json --non-interactive 2>"$CLI_ERR")" || {
  show_cli_error
  fail "eas-cli fingerprint:generate failed, so the project fingerprint is
  unknown. Nothing below can be checked against it."
}

FINGERPRINT="$(printf '%s' "$FINGERPRINT_JSON" | python3 -c '
import json, sys
try:
    result = json.load(sys.stdin)
except Exception as error:
    sys.exit(f"fingerprint:generate did not print JSON: {error}")
value = result.get("hash") if isinstance(result, dict) else None
if not isinstance(value, str) or not value:
    sys.exit("fingerprint:generate printed JSON with no usable \"hash\" field")
print(value)
')" || fail "Could not read the fingerprint out of eas-cli's reply."
ok "fingerprint $FINGERPRINT"

# The same distinction on the way back: a CLI that could not ask is not an
# account with no builds. Reporting the first as the second sends you off
# to spend thirty minutes on a build you already have.
BUILDS_JSON="$(npx eas-cli build:list --channel "$CHANNEL" --platform "$PLATFORM" \
  --status finished --limit 20 --json --non-interactive 2>"$CLI_ERR")" || {
  show_cli_error
  fail "eas-cli build:list failed, so which builds exist is UNKNOWN — that is
  not the same as there being none, and building is not the answer to it.
  Check authentication and network first:  npx eas-cli whoami"
}

RUNTIMES="$(printf '%s' "$BUILDS_JSON" | python3 -c '
import json, sys
try:
    builds = json.load(sys.stdin)
except Exception as error:
    sys.exit(f"build:list did not print JSON: {error}")
if not isinstance(builds, list):
    sys.exit("build:list printed JSON that is not a list of builds")
seen = []
for build in builds:
    runtime = build.get("runtimeVersion") if isinstance(build, dict) else None
    if runtime and runtime not in seen:
        seen.append(runtime)
print("\n".join(seen))
')" || fail "Could not read the build list out of eas-cli's reply."

if [ -z "$RUNTIMES" ]; then
  fail "EAS answered, and there are no finished $PLATFORM builds on channel
  '$CHANNEL' — so there is nothing for an update to reach. Build first."
fi

if ! printf '%s\n' "$RUNTIMES" | grep -qx "$FINGERPRINT"; then
  printf '\nMost recent runtime versions on %s:\n' "$CHANNEL"
  printf '%s\n' "$RUNTIMES" | head -5 | sed 's/^/  /'
  fail "The fingerprint matches NO build on '$CHANNEL'. Something native has
  changed since those binaries were made, so an update published now
  would be offered to nobody.

  The answer is a new build — never a looser runtimeVersion policy."
fi

ok "a finished build on '$CHANNEL' runs this exact fingerprint"

# The workflow runs this same bar again on EAS, which is what makes it
# enforced rather than remembered. This script is the fast copy, and the
# only one that can see an uncommitted file or an unlanded branch.
printf '\n\033[32mPreflight passed.\033[0m Publish with:\n'
if [ "$CHANNEL" = 'production' ]; then
  printf '  eas workflow:run .eas/workflows/ota-production.yml\n\n'
else
  printf '  npx eas-cli update --branch %s --environment %s\n\n' "$CHANNEL" "$CHANNEL"
fi
