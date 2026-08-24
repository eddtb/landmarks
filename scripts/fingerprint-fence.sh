#!/usr/bin/env bash
#
# Does this change move the native fingerprint? Say so BEFORE it merges.
#
# On 10 Aug, #306 edited a config plugin — a native change, and its own
# PR body said "moves the fingerprint, needs a build". It merged; ~25
# JS-only PRs then merged behind it over five days, every one OTA-able
# work made unreachable, because no build matching the new fingerprint
# existed — and nothing made that state visible. The publish-time
# preflight catches it (too late); the fingerprint policy protects
# phones (correctly); the gap was at MERGE time. This script is the
# merge-time half: compare the iOS fingerprint at a PR's base and head,
# and when they differ, name the files that moved it.
#
# Deliberately KEYLESS: it compares base-vs-head, never head-vs-builds.
# "Does a finished build exist for this fingerprint?" needs EAS
# credentials and lives in scripts/preflight-ota.sh, where they exist.
#
# Method — one work dir, sequential checkouts, and that is load-bearing:
# @expo/fingerprint hashes each source's RELATIVE PATH into the final
# hash (createSourceId returns filePath), so two checkouts whose
# node_modules resolve to different relative paths disagree about every
# node_modules source and the comparison lies. One temp worktree,
# checked out to base then head, sees identical paths both times.
#
# node_modules: when package-lock.json is identical between the two
# refs, the parent checkout's install is symlinked in and shared. That
# is correct even if the local install is stale: both runs see the SAME
# node_modules, so its contribution cancels out of the comparison, and
# an identical lockfile means the true contribution is identical too —
# the verdict is driven by the tracked files, which is the question
# being asked. When the lockfile DIFFERS between refs, each side gets
# its own `npm ci`, because a dependency bump is exactly the kind of
# change that moves the fingerprint. (Consequence: hashes printed here
# are only comparable to EACH OTHER — the temp path changes the source
# ids — never to a fingerprint computed elsewhere.)
#
# Exit 0: hashes match — the change can ride OTA.
# Exit 1: hashes differ — merging closes the OTA road (see the message).
# Exit 2: the comparison itself could not run. Never conflated with 1:
#         "I could not find out" is not "the fingerprint moved".
#
# Usage: scripts/fingerprint-fence.sh <base-ref> <head-ref>

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: scripts/fingerprint-fence.sh <base-ref> <head-ref>" >&2
  exit 2
fi

fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 2; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }

ROOT="$(git rev-parse --show-toplevel)" || fail "not inside a git repository"
BASE_SHA="$(git rev-parse --verify --quiet "$1^{commit}")" || fail "cannot resolve base ref: $1"
HEAD_SHA="$(git rev-parse --verify --quiet "$2^{commit}")" || fail "cannot resolve head ref: $2"

printf 'Fingerprint fence — base %s, head %s\n\n' "${BASE_SHA:0:9}" "${HEAD_SHA:0:9}"

if [ "$BASE_SHA" = "$HEAD_SHA" ]; then
  ok "base and head are the same commit — native fingerprint unchanged"
  exit 0
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/fingerprint-fence.XXXXXX")"
WORK="$TMP/proj"
cleanup() {
  git -C "$ROOT" worktree remove --force "$WORK" 2>/dev/null || true
  rm -rf "$TMP"
  git -C "$ROOT" worktree prune 2>/dev/null || true
}
trap cleanup EXIT

git -C "$ROOT" worktree add --detach --quiet "$WORK" "$BASE_SHA" \
  || fail "could not create a worktree at $BASE_SHA"

# One install or two? See the header: identical lockfile => shared
# symlink is sound; a differing lockfile must be installed per side.
if git -C "$ROOT" diff --quiet "$BASE_SHA" "$HEAD_SHA" -- package-lock.json; then
  LOCK_SAME=1
  [ -e "$ROOT/node_modules" ] || fail "no node_modules at $ROOT — run npm ci first"
  ln -s "$ROOT/node_modules" "$WORK/node_modules"
  ok "package-lock.json identical between refs — sharing the existing install"
else
  LOCK_SAME=0
  echo "package-lock.json differs between refs — npm ci per side (the slow, honest path)"
  (cd "$WORK" && npm ci --no-audit --no-fund --silent) || fail "npm ci failed at base"
fi

fingerprint() { # $1: output file, $2: label
  local started elapsed
  started=$SECONDS
  (cd "$WORK" && EXPO_NO_TELEMETRY=1 \
    npx expo-updates fingerprint:generate --platform ios > "$1" 2> "$TMP/stderr.txt") \
    || { sed 's/^/  │ /' "$TMP/stderr.txt" >&2; fail "fingerprint:generate failed at $2"; }
  elapsed=$((SECONDS - started))
  ok "$2 fingerprint computed (${elapsed}s)"
}

fingerprint "$TMP/base.json" "base"

git -C "$WORK" checkout --force --detach --quiet "$HEAD_SHA" \
  || fail "could not check out $HEAD_SHA"
if [ "$LOCK_SAME" = 0 ]; then
  (cd "$WORK" && npm ci --no-audit --no-fund --silent) || fail "npm ci failed at head"
fi

fingerprint "$TMP/head.json" "head"

# The verdict. All reporting lives here so the message and the exit
# code can never disagree; this node process's exit status is the
# script's (it is the last command).
node - "$TMP/base.json" "$TMP/head.json" <<'JS'
const fs = require('fs');
const [baseFile, headFile] = process.argv.slice(2);
const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
const head = JSON.parse(fs.readFileSync(headFile, 'utf8'));

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const summarize = (md) => { if (summaryPath) fs.appendFileSync(summaryPath, md + '\n'); };

if (base.hash === head.hash) {
  const msg = `Native fingerprint unchanged (${head.hash}) — this PR can ride OTA.`;
  console.log(`\n✓ ${msg}`);
  summarize(`## Fingerprint fence\n\n${msg}`);
  process.exit(0);
}

// Name the culprits: index each run's sources by identity, then walk
// the union. `contents` sources are identified by id, files/dirs by
// their (relative) path — the same identity the hash itself uses.
const index = (fp) => new Map(fp.sources.map((s) => [s.type === 'contents' ? s.id : s.filePath, s]));
const a = index(base);
const b = index(head);
const culprits = [];
for (const [id, s] of b) {
  const was = a.get(id);
  if (!was) culprits.push(`added    ${id}  (${s.reasons.join(', ')})`);
  else if (was.hash !== s.hash) culprits.push(`changed  ${id}  (${s.reasons.join(', ')})`);
}
for (const [id, s] of a) {
  if (!b.has(id)) culprits.push(`removed  ${id}  (${s.reasons.join(', ')})`);
}

const TOP = 15;
const shown = culprits.slice(0, TOP);
const more = culprits.length - shown.length;

const lines = [
  '',
  `✗ Native fingerprint MOVED: ${base.hash} → ${head.hash}`,
  '',
  `What moved it (${culprits.length} source${culprits.length === 1 ? '' : 's'}):`,
  ...shown.map((c) => `  ${c}`),
  ...(more > 0 ? [`  … and ${more} more`] : []),
  '',
  'Merging this closes the OTA road for every PR behind it until a',
  'build ships. Pair it with a build, or hold it — or cherry-pick the',
  'JS onto the release branch (release-<build>), which tracks the',
  'shipped binary and stays OTA-able regardless of main.',
  '',
  'This red is ADVISORY: a deliberate native change merges past it',
  'with open eyes, WITH a build plan — the build cut the same day, or',
  'the change held on its branch. What it must never do is merge and',
  'let JS work queue behind it (#306: five days, ~25 unreachable PRs).',
];
console.error(lines.join('\n'));
summarize(
  `## Fingerprint fence\n\n**Native fingerprint moved:** \`${base.hash}\` → \`${head.hash}\`\n\n` +
  `What moved it:\n\n\`\`\`\n${shown.join('\n')}${more > 0 ? `\n… and ${more} more` : ''}\n\`\`\`\n\n` +
  `Merging this closes the OTA road for every PR behind it until a build ships. ` +
  `Pair it with a build, hold it on its branch, or cherry-pick the JS onto the ` +
  `release branch (\`release-<build>\`). This red is advisory — a deliberate native ` +
  `change merges past it with open eyes, with a build plan (#306: five days, ~25 unreachable PRs).`
);
process.exit(1);
JS
