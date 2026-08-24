# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Expo agent skills

The official Expo plugin (`expo@claude-plugins-official`, enabled in
`.claude/settings.json`, installed at project scope) provides `expo-*`
framework skills and `eas-*` service skills. Use the matching skill when
one exists — `eas-hosting` for API-route deployment, `eas-workflows` for
CI/CD YAML, `expo-router`/`expo-dev-client` for framework work. Skills
complement the versioned-docs rule above; they don't replace it.

# Repo skills (.claude/skills/)

This repo's own runbooks, encoded: `verifier-simulator` (UI evidence
via Maestro — use before any UI PR), `record-caches` (the REPLAY_ONLY-
off recording session; needs Edd's go), `device-triage` (Edd's phone
findings → diagnosed, verified, merged PRs), `perf-audit`. Prefer
invoking these over rediscovering their contents.

`skill-creator` is installed to author and improve these — use it
rather than hand-rolling a new SKILL.md, and `claude-md-improver`
when this file drifts from what the repo actually does.


# frontend-design does not outrank the HIG

`frontend-design` is installed for visual direction and for its
writing guidance — interface copy names what the user controls, an
action keeps its verb through the whole flow ("Publish" → "Published"),
errors say what broke and what fixes it, and an empty screen is an
invitation rather than an apology. Take all of that.

Its design half is web-shaped and its instinct is to avoid anything
that reads as a default. This app IS a defaults app: native iOS,
liquid glass, `expo-glass-effect`, `@expo/ui`. Where the two disagree
on anything a reviewer sees, `expo-native-ui` and the Apple HIG win —
1.0(6) was rejected under 4.2.2 twice, and "distinctive" is not a
defence. Spend the boldness on the map and the telling, not the chrome.


# Paid APIs: replay-only development

Development and testing NEVER bill — and since the Storyteller pivot
(PR #117) nothing in the codebase CAN bill: Google is gone, Anthropic
is a dormant fallback behind an explicit `AI_PROVIDER=anthropic` flip.
The discipline stays anyway. Dev servers started for probing run with
`REPLAY_ONLY=1` — AI calls refuse at the budget choke point and routes
degrade to the disk caches in `.ai-cache/` (recorded responses;
gitignored — do not commit or delete). Unit tests are mocked; CI is
keyless. Note: REPLAY_ONLY also refuses FREE Gemini calls, so a dev
server on that flag cannot write new tellings — only replay cached ones.


# Shipping: two roads to a phone

A change reaches users one of two ways, and the difference is not a
preference.

**OTA (EAS Update)** — JavaScript, styles, assets. Published
deliberately: `eas workflow:run .eas/workflows/ota-production.yml`.
No review, no wait; also no undo but a rollback publish, so an OTA
carries the same test/lint/typecheck bar as anything else.

**Run `scripts/preflight-ota.sh <channel>` first.** An `eas update`
always says "Published!" — whether any phone RECEIVES it depends on the
runtime version matching a binary that exists, and nothing tells you
when it doesn't. An update nobody can receive is indistinguishable from
one everybody got. The preflight refuses a dirty tree (untracked files
included — an untracked `app.config.js` replaces `app.json` outright), a
red suite, a HEAD the reviewed line does not contain, and a fingerprint
that matches no finished build on the channel.

The workflow runs that same bar again on EAS — typecheck, lint, tests,
then a fingerprint that must match a finished build — so it is enforced
rather than remembered (#288). The script stays the fast copy, and the
only one that can see an uncommitted file or an unlanded branch. When
HEAD is deliberately ahead of `origin/main`, name the line being
shipped: `PREFLIGHT_BASE_REF=origin/<branch>`.

**`eas update` writes to app.json.** It auto-configures any platform
missing a `runtimeVersion` policy, and serialises the config back out
AFTER the plugins have run — so expo-location's permissions and the
`location` background mode return duplicated, three plugin-default
permissions appear, and the native fingerprint silently moves. Both
platforms therefore declare `fingerprint` explicitly, and
`src/__tests__/app-config-test.ts` fails CI if that corruption returns.
Never fix a fingerprint mismatch by loosening the policy; build.

**A build** — everything that touches the native runtime: a new native
module, an SDK bump, a permission string, an app.json plugin change.
The `fingerprint` runtimeVersion policy decides which of the two a
change is, by computing the native fingerprint rather than trusting
anyone to remember: change the runtime and old binaries stop being
offered the update instead of crashing on it. When a phone stops
receiving updates, the answer is a new build — never a looser policy.

**A native change merges only WITH a build plan.** #306 proved the
gap: a config-plugin edit whose own body said "moves the fingerprint,
needs a build" merged on 10 Aug, and for five days ~25 JS-only PRs
merged behind it — every one OTA-able, none receivable, because no
build matching the new fingerprint existed and nothing said so. The
preflight catches this at publish time, too late for the queue; the
runtimeVersion policy protects phones, a different job. The merge-time
gap is `fingerprint-fence.yml`'s: every PR computes the iOS
fingerprint at its base and its head (`scripts/fingerprint-fence.sh`),
and one that moves it goes red naming the files that moved it. The red
is ADVISORY — not a required check; making it one is Edd's ruleset
call — and a deliberate native change merges past it with open eyes:
the build cut the same day, or the change held on its branch. JS work
never queues behind an unbuilt native change. The invariant: the
production channel always holds a finished build matching the tip's
fingerprint — remembering a finished build is necessary, but only a
binary ON PHONES reopens the road.

**The release branch is the standing answer.** `release-<build>`
always tracks the SHIPPED binary's native surface. A JS-only fix
cherry-picks onto it and publishes OTA at any time, regardless of what
native work is on main — that is the always-OTA-able guarantee. Native
changes ride main; when their binary ships, the release branch re-cuts
from that build's commit. The fingerprint is a conservative proxy —
#306's change was in fact JS-compatible — which is exactly why the
release-branch route can republish this week's JS to the old binaries.

Server-side API routes are a third road entirely: they reach every
client at once, binary or not. The command is:

```
npx expo export -p web
npx eas-cli deploy --prod --environment production
```

**`--environment production` is not optional.** Without it the worker
deploys with NO server-side environment: no `TURSO_DATABASE_URL`, so
the durable store silently switches off and every cache — tellings,
retellings, feeds — becomes per-isolate memory again. It fails
quietly, exactly like the mode the store is designed to degrade into,
and it cost a day: #231's store was dead in production from the day it
shipped and nobody could tell, because the edge offers no log to read.
**Run `scripts/postflight-deploy.sh <base-url>` after.** All five
store-backed routes (history, telling, retold, quiz, area) now answer
with `x-feed-store: ok | off | error` UNCONDITIONALLY, plus
`x-feed-store-error` in a fixed vocabulary (`off`/`auth`/`timeout`/
`sql`/`unknown` — never libsql's own text, which names the database
host on a public header). The postflight asks a feed twice and refuses
a deploy that answers anything but HTTP 200 (curl exits 0 on a 500 —
only the status line knows), whose store says anything but `ok` on
EITHER ask, or whose second answer is not a cache hit — a store that
answers `ok` and never serves one is remembering nothing.


# AI call-site audit (keep this table true)

Every AI call passes a budget breaker — these are ALL of them. Any new
AI call-site must be added here WITH its cache. Data upstreams
(Wikipedia, Historic England, Open Plaques, Geograph) are keyless or
free-keyed and unmetered — they don't belong in this table.

| Call (kind)          | Cache                    | Cost |
|----------------------|--------------------------|------|
| Gemini telling (ungrounded, ~400 tok) | tellings 30d, key `<pageId>:<SHA-256 of the extract, truncated to 96 bits>` — a fabricated POST can only poison its own slot. Turso durable store ('telling' kind; survives worker recycles, off without TURSO_DATABASE_URL) + per-process map + device session cache + single-flight per key. NOTE the device cache keys on pageId ALONE, so a changed extract serves the stale telling for the session | free tier; SHARED 300-calls/day breaker |
| Gemini retelling (ungrounded, ~4500 tok over ≤24k source chars — **the most expensive call in the app**) | retold 30d told / 7d no-retell verdict, key `v4:<area name>`. No source digest and none needed — the source is fetched server-side, not sent by the client. The key IS attacker-choosable, so the route caps it at 300 chars and refuses anything with no letter in it or a control character in it (#279). Turso ('retold' kind) + per-process map + device session cache, single-flight per key. Refuses below 1500 source chars WITHOUT calling | free tier; SHARED 300-calls/day breaker |
| Gemini area quiz (ungrounded, ~2048 tok) | quiz 30d told / 7d no-quiz verdict, key `v5:<area name>`. No source digest and none needed — like retold, the material is fetched server-side: `GET /api/quiz?lat=&lng=` resolves the area with `findNearestArea` and takes the nearest twelve named places from `findNearbyHistory` (widening on the feed's own sparse rule). The route carries NO client material, so there is nothing a fabricated request could put in the slot (#303), and the key space is closed — only Wikipedia titles Wikidata classes as areas can become keys, so retold's 300-char cap has nothing to bite on. Turso ('quiz' kind) + per-process map (`{ttlMs: 30d, maxEntries: 1000}` — the LONGER TTL, as retold's is, because pruning is a write rule and the 7-day no-quiz clock is a read rule; 1,000 is one slot per named area now the key is the area alone) + device session cache (keyed on the area) + single-flight. Refuses below 3 usable stories WITHOUT calling. The upstream compose happens only on a cache MISS, so it costs one keyless Wikipedia fan-out per area per 30 days | free tier; SHARED 300-calls/day breaker |
| Valhalla walking route (FOSSGIS) | routes 24h (per ~27m origin bucket + destination) — per-process map ONLY, no durable store, so on the edge the cache dies with each isolate and the breaker is the real protection | free community server; its OWN 300-calls/day breaker out of politeness |
| Anthropic `claude-haiku-4-5` (dormant fallback) | n/a — only via explicit AI_PROVIDER=anthropic; a missing Gemini key throws rather than falling through | paid; assertBudget breaker, $1/day default (AI_DAILY_BUDGET_USD); boot log asks "is this intended?" |

**One rule holds over all of them, and `src/server/__tests__/cache-key-trust-test.ts`
fences it across every store-backed route:** no two requests may write
the SAME durable key with DIFFERENT values on the strength of content
the client supplied. A route may accept content (the telling does) so
long as the content is in the key; or it may key on a plain identity
(an area, a bucket) so long as it fetches its own material. The
forbidden middle — a shared key over material a stranger chose — is
what #303 was.

**The three Gemini rows share ONE ledger** (`gemini-call-ledger`,
300/day, `GEMINI_DAILY_CALLS`) — they are not three independent caps.
Both ledgers are themselves durable (Turso 'ledger' kind, atomic
single-statement increment), which is what makes "300/day" true across
isolates rather than 300 per isolate lifetime. **Without
TURSO_DATABASE_URL the cap silently degrades to per-isolate** — which
is now visible rather than silent: reads and writes both colour
`x-feed-store`, and a store that is off says so on every answer.


# The React Compiler is on, and it bails in silence

`experiments.reactCompiler` is enabled. When it cannot compile a
component it does not warn, does not fail lint, and does not fail the
build — it simply leaves that component unoptimised while every file
around it looks identical. Two things opt a component out:

1. **A conditional inside a `try`/`catch`.** A ternary, `&&`, or
   optional chaining within a `try` block produces *"Support value
   blocks within a try/catch statement"* and the compiler abandons the
   **entire enclosing function**. Hoisting the conditional out of the
   `try` does not help; the block must leave the component — extract it
   into a module-level async helper that returns a verdict.
2. **`// eslint-disable-next-line react-hooks/*`.** One disable comment
   de-optimises the whole component it sits in.

Verify rather than assume — ask the compiler and read its own log:

```
node scripts/react-compiler-scan.js
```

It runs the real pipeline (`babel-preset-expo` with
`supportsReactCompiler`, Metro's production caller) over every `.tsx` in
`src/components` and `src/app`, and prints what compiled, what bailed
and why — the reason is the compiler's own, from its logger, not a guess
read off the output. A component absent from the compiled list is not
compiled; adding a derivation to it costs per-render work that nothing
will report. `src/__tests__/react-compiler-test.ts` runs the same scan in
CI, and fails on a new bail.

**Do not hand-roll this.** This file used to recommend
`npx babel <file> --presets babel-preset-expo | grep '_c('`. There is no
`@babel/cli` in this tree, so `npx babel` fetches the abandoned babel@6
shim and throws. A `@babel/core` one-liner does not work either: without
`caller.supportsReactCompiler` the preset never adds the compiler plugin
at all, and the file transforms clean with zero `_c(` — indistinguishable
from "nothing compiled". That is how `glass-header.tsx` was read as
compiling nothing when it compiles three components. Grepping for `_c(`
also cannot say WHICH function bailed, or why. Run the script.


# Design rules that enforce themselves

Every rule in `docs/DESIGN.md` used to be enforced by reading, and the
August 2026 review found the same shape repeatedly: a rule written down,
obeyed by hand, quietly broken (#299). Four fences now fail instead
(`app-config-test.ts` was the precedent — the fence lives in the suite,
because the suite is what CI runs):

| Fence | Catches |
|---|---|
| `src/__tests__/palette-test.ts` | a colour literal in `src/components`/`src/app` outside the allowlist; white text on a `theme.accent` surface; a native splash/icon colour that has left the palette |
| `src/__tests__/type-ramp-test.ts` | a fourth inline `fontSize`; a sanctioned one that stops explaining itself; a `ThemedText` tier defined and rendered nowhere |
| `src/__tests__/control-names-test.ts` | a glyph reaching a tappable's accessible name (a drawn glyph is fine — give it an `accessibilityLabel`) |
| `src/__tests__/react-compiler-test.ts` | a load-bearing component that stopped compiling, and any new silent bail |

`eslint.config.js` carries the palette rule too, at typing speed: its
granularity is the FILE, the test's is the VALUE, and the test asserts
the two lists agree.

**`src/test-utils/design-allowlist.ts` is the ledger.** Two kinds of
entry, and the difference is the whole point: `Sanctioned*` is approved
with the reason at the entry; `Quarantined*` is a known violation that
is scheduled, not forgiven. Both are asserted EXACTLY — fix a
quarantined violation and the fence fails, telling you to delete its
entry. The lists can only shrink. **Never add to a `Quarantined*` list
to get green**; that is the failure mode these fences exist to stop.


# A check that cannot fail is not a check

The August 2026 review found one fault wearing ten different clothes: a
check that reports success without doing its work. The account is in
`docs/postmortems/2026-08-12-the-hollow-signal.md`; these are the rules
it left. One question separates them from every sound check standing
beside them — **what does this check do when the thing it watches is
broken?** If the answer is "nothing", it is not a check.

**Never read an exit code through a pipe.** `cmd | tee` reports `tee`'s
status, and GitHub's default `run:` shell is `bash -e {0}` with no
`pipefail`. That is exactly how the only required check lost the ability
to fail on a red suite (#278) — and it was then reproduced by hand twice
in one afternoon, so knowing about it is not protection. Read the status
of the command you actually care about: `shell: bash` selects
`-eo pipefail`, and locally either drop the pipe or read
`${PIPESTATUS[0]}`.

**A test that has never failed is not a fence.** Revert the fix, watch
it go red, restore it. #313 did that 22 times and two of the reverts
found bugs in its own tests. Assert on what the user gets — the rendered
output, the generated artefact — never on a mock, an input or an
intermediate: `app-config-test.ts` asserted the SOURCE config while the
generated plist shipped five capability keys into App Review (#284), and
`wander-elsewhere-test.tsx` asserted a hidden banner while a fabricated
central-London feed rendered beside it (#289). Ten more of the same
shape are open at #312.

**Take both halves of a merge conflict, or neither.** #315: main deleted
an asset AND the dead component that required it; the resolution took
the deletions and kept the component, and the app could not bundle.
Typecheck, lint and 1,010 tests were green over it — `tsc` never
resolves a `require()` of a PNG, jest stubs everything under `assets/`,
and nothing in CI bundles the app. Splitting a two-part change is not
the cautious half; it is the half no check can see.

**Verify a worktree's base before the first edit.**
`git merge-base --is-ancestor HEAD origin/main` must exit **1**. Agent
worktrees have silently arrived at `main` while their brief described
this line — 84 commits apart on 10 August, 97 two days later — with
whole files from the brief not yet existing. Unchecked, the work lands
against a tree nobody asked about.

**Green on your branch is not green on the base.** A run measures the
tree the work was written on, and the base moves under it. When one goes
red, ask whether the base is already red before assuming the failure is
yours: #313 and #314 both went red at 14:45 because #311's ratchet
landed at 14:05, and neither had broken anything.


# Do not run `npm audit fix --force`

The remaining advisories are dev/build-time only and none ships in the
bundle. The "fix" npm proposes is no longer a jest downgrade: as of
August 2026 it proposes **SDK 56 → SDK 53**, React Native 0.85 → 0.72
and Reanimated 4.3 → 4.2. Clear advisories deliberately, with the next
Expo upgrade, using the `expo-upgrade` skill.
