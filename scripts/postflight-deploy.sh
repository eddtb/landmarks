#!/usr/bin/env bash
#
# Prove the deployed worker still has a durable store.
#
# `eas deploy` without `--environment production` ships a worker with NO
# server-side environment: no TURSO_DATABASE_URL, so the durable store
# switches off and every cache — tellings, retellings, quizzes, feeds,
# and the shared 300-calls-a-day ledger — becomes per-isolate memory
# again. It fails QUIETLY, exactly like the mode the store is designed
# to degrade into, and the edge offers no log to read. #231's store was
# dead in production from the day it shipped and nobody could tell.
#
# So the routes answer with their own health and this script reads it:
#
#   x-feed-store: ok | off | error   what the durable store is doing
#   x-feed-store-error: off|auth|timeout|sql|unknown   why it last refused
#   x-feed-cache: compose | process-hit | store-hit    where this feed came from
#
# Two asks at the same coordinates. The first may legitimately compose;
# the second must not, because the first should have left something
# behind. Composing twice means nothing is being remembered.
#
# Usage: scripts/postflight-deploy.sh [base-url]
#   base-url defaults to $EXPO_PUBLIC_API_ORIGIN — the same origin the
#   app itself is built against. The host is deliberately not written
#   down here: a postflight that probes the wrong deployment passes
#   while production is dead, which is the failure it exists to catch.

set -euo pipefail

BASE="${1:-${EXPO_PUBLIC_API_ORIGIN:-}}"
[ -n "$BASE" ] || {
  printf 'Usage: scripts/postflight-deploy.sh <base-url>\n' >&2
  printf '   or: EXPO_PUBLIC_API_ORIGIN=https://… scripts/postflight-deploy.sh\n' >&2
  exit 2
}
BASE="${BASE%/}"
# Greenwich: dense ground, so a compose here always has stories to store
FEED="${BASE}/api/history?lat=51.4826&lng=-0.0077"

fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }

printf '\nDeploy postflight — %s\n\n' "$BASE"

# An ABSENT header is the answer this script cares most about, so it
# must survive grep's exit 1 rather than take the whole run down with it
header() { printf '%s\n' "$2" | grep -i "^$1:" | tail -1 | tr -d '\r' | cut -d' ' -f2- || true; }

# Headers only — the body is a feed of stories nobody here needs to read
ask() { curl -sS -i -m 120 "$FEED" | sed -n '1,/^\r*$/p'; }

FIRST="$(ask)" || fail "could not reach $FEED"
STORE_1="$(header x-feed-store "$FIRST")"
CACHE_1="$(header x-feed-cache "$FIRST")"
ERROR_1="$(header x-feed-store-error "$FIRST")"

# Absence is the loudest answer of all: every route emits x-feed-store
# unconditionally now, so a missing header means the deploy is older
# than this script and cannot be checked by it.
[ -n "$STORE_1" ] || fail "No x-feed-store header. This deploy predates the store-health
  headers — deploy again from a build that has them before trusting it."

printf '  first ask:  x-feed-store: %s%s, x-feed-cache: %s\n' \
  "$STORE_1" "${ERROR_1:+ ($ERROR_1)}" "$CACHE_1"

case "$STORE_1" in
  ok) ok "the durable store is configured and answering" ;;
  off)
    fail "The durable store is OFF: the worker has no TURSO_DATABASE_URL.
  Almost certainly deployed without --environment production. Every
  cache is per-isolate memory and the 300-calls/day cap is now 300 per
  isolate lifetime. Redeploy:

    npx expo export -p web
    npx eas-cli deploy --prod --environment production" ;;
  error)
    fail "The durable store is configured but FAILING (${ERROR_1:-unknown}).
  auth — the token is wrong or expired; timeout — Turso unreachable;
  sql — the table is gone or its shape moved." ;;
  *) fail "Unrecognised x-feed-store value: '$STORE_1'" ;;
esac

SECOND="$(ask)" || fail "could not reach $FEED on the second ask"
STORE_2="$(header x-feed-store "$SECOND")"
CACHE_2="$(header x-feed-cache "$SECOND")"

printf '  second ask: x-feed-store: %s, x-feed-cache: %s\n' "$STORE_2" "$CACHE_2"

if [ "$CACHE_1" = 'compose' ] && [ "$CACHE_2" = 'compose' ]; then
  fail "Composed twice for the same ground. A store that answers 'ok' but
  never serves a hit is remembering nothing — check that the two asks
  landed on the same deployment, then read the worker's Turso config."
fi

ok "the second ask came back a hit ($CACHE_2) — the store is remembering"
printf '\n\033[32mPostflight passed.\033[0m\n\n'
