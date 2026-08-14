# Post-mortem: the hollow signal

**Date:** 2026-08-10 (review) — 2026-08-12 (last fix merged) · **Severity:** internal, two shipped consequences
**Status of corrective actions:** eight of ten complete; #312 and the review robot's zero-exit remain open

## Summary

A seven-dimension review of Venture on 10 August filed **24 issues**;
sixteen closed within two days across **13 merged PRs**. Read together
— with the day's own three mistakes — they are not twenty-four faults.
They are one fault wearing many clothes: **a check that reports success
without doing its work.**

Not a missing test. A green tick that meant nothing, in a place where
somebody had deliberately put a check.

## Impact

- **Two bugs shipped behind green suites.** The binary in front of App
  Review (1.1.0 build 11) declared five `Info.plist` keys for four
  capabilities the app never uses — the 4.2.2 shape that already cost
  1.0(3) — while `app-config-test.ts` passed (#284). A user who tapped
  "Not now" on location was shown Trafalgar Square and the Banqueting
  House as their surroundings, each with a walk time, while
  `wander-elsewhere-test.tsx` asserted the *banner* was correctly
  hidden (#289).
- **The only required check could not fail on a red suite** (#278).
- **The nightly E2E was red for twenty consecutive nights**, notifying
  nobody, behind an app that was working perfectly (#285).
- **The app could not bundle** off main's own merge; typecheck, lint
  and 1,010 tests were green over it (#315).

## The instances

| # | The check | What it did when the thing it watched broke | Ref |
|---|---|---|---|
| 1 | CI's test step piped into `tee` | Reported `tee`'s exit code. GitHub's default `run:` shell is `bash -e {0}` with no `pipefail`, so jest's status was discarded. Typecheck and lint were unpiped and did gate; tests did not | #278 |
| 2 | `merge-chain.yml`'s `\|\| true` | Dead token, merge conflict, fork head and rate limit all exited 0. **All 47 runs in its history are `success`, and none could ever have been otherwise** | #286 |
| 3 | The nightly E2E | Failed twenty nights running over one unanswered SpringBoard dialog — *Open in "Venture"?* — behind which the feed was fine. Schedule-only, not required, notifying no one | #285 |
| 4 | The review robot on a workflow PR | Refuses to run when the PR edits its own workflow file, and **exits success**. A pass for a review that never ran | #302 |
| 5 | `app-config-test.ts` | Asserted absence in the **source** config, where the keys are genuinely absent. The plugin defaults put them in the **generated** plist | #284 |
| 6 | `wander-elsewhere-test.tsx` | Asserted the banner was hidden. The fabricated central-London feed rendered beside it, unasserted | #289 |
| 7 | Ten more tests that cannot fail | Including the stated fence for the 4.2.2 republication rule, which asserts no row has kind `'fallback-article'` — a kind that exists nowhere in the union or the codebase. Unfalsifiable by construction | #312 |
| 8 | The whole suite, over a broken merge | Main deleted the splash assets **and** the dead `AnimatedIcon` requiring one; the resolution took the deletions and kept the component. `tsc` never resolves a `require()` of a PNG, jest's `moduleNameMapper` stubs everything under `assets/`, and **nothing in CI bundles the app** | #315 |
| 9 | Two PRs green apart, red together | #313's only CI run failed on `palette-test` and `glass-fences-test`, 41 minutes after #311 merged the ratchet it was being measured against | #311 + #313 |
| 10 | Hand-rolled tool checks | `npx babel` resolved to the abandoned babel@6 shim; a `@babel/core` one-liner answered "nothing compiled" for a file with three compiled components, because without `caller.supportsReactCompiler` the preset never adds the plugin at all | AGENTS.md |

## Root cause

**Every one of these was introduced by someone being careful.** `|| true`
was there so a chain hiccup would not block a merge. `tee` was there so
the log would be readable. `app-config-test.ts` exists *because*
`eas update` corrupts app.json, and it is the precedent the entire
self-enforcing-fences section cites. Each was individually reasonable
and none was a shortcut.

The shared mechanism is **adjacency**: each check watched something one
step away from the thing that mattered. `tee`'s exit code is adjacent to
jest's. The source config is adjacent to the generated plist. A hidden
banner is adjacent to the feed rendered next to it. A `testID` is
adjacent to the needle's angle. In every case the observed thing was
real and the assertion honest; the answer was worthless.

Nothing reports this, and nothing can. **A check that cannot fail and a
check that passes are the same colour.** Coverage counts the assertion,
never its reachability; a required check that is structurally incapable
of failing wears the same green tick as one that just did real work.

## The tell

**Ask what this check does when the thing it watches is broken. If the
answer is "nothing", it is not a check.**

The question is free, needs no tooling, and separates all ten instances
from every sound check standing beside them.

## What caught them in the end

The transferable part is here, not in the failures.

- **A ratchet that asserts in both directions.** #311's
  `design-allowlist.ts` asserts its `Sanctioned*` and `Quarantined*`
  lists **exactly**: a new violation fails because it is not listed, and
  a *repaired* one fails too, naming the entry to delete. The second
  direction is the one that pays. Deleting `AnimatedIcon` turned three
  quarantined colours green and the suite refused to pass until their
  entries left the ledger — a one-directional allowlist would have said
  nothing at all. #314's repaired React Compiler bail was caught the
  same way.
- **Revert-proofing.** #313 reverted 22 fixes, watched each go red, and
  restored them. Two of the 22 found bugs in its own tests: one fence
  matched `export function GlassPanel` as a prefix and waved
  `GlassPanelRenamed` straight through. A test never observed failing is
  a hypothesis.
- **Asking whether the base was already red.** #313 and #314 both went
  red at 14:45. The move that worked was not hunting a regression inside
  either branch — it was noticing #311 had landed at 14:05, and that
  both were being measured against a tree neither was written on.
- **Reading the artifact instead of the summary.** "7/7 flows failed on
  seven different anchors" reads as rot; the screenshot showed a working
  Greenwich feed with 83 stories behind an alert. The `--debug-output`
  that would have shown this twenty nights earlier was writing to a
  dot-directory `upload-artifact` skips by default.

## Corrective actions

| # | Action | Where |
|---|---|---|
| 1 | `shell: bash` on the test step — `-eo pipefail`, so a red suite fails the only required check | `.github/workflows/ci.yml` (#278) |
| 2 | The chain reads its command's output: only "already up-to-date" is tolerated, everything else is `::error::` and exit 1; the silent `github.token` fallback deleted | `.github/workflows/merge-chain.yml` (#302) |
| 3 | `subflows/confirm-open.yaml` after every `openLink`; `include-hidden-files: true`; one deduplicated issue on failure, modelled on the token canary | `.maestro/` + workflow (#302) |
| 4 | All five keys stripped in the plugin; the test retargeted at the plugin's **output** plist, and asserting the used key survives — a fence that strips everything would pass and ship a location app that cannot locate | `plugins/with-honest-capabilities.js` (#306) |
| 5 | Four self-enforcing fences over a two-directional ledger | `src/__tests__/{palette,type-ramp,control-names,react-compiler}-test.ts` (#311) |
| 6 | Every `@/assets/…` in `src/` must exist on disk — the one check that would have caught the merge | `src/__tests__/asset-references-test.ts` (#315) |
| 7 | The compiler scan runs the real pipeline and quotes the compiler's own reason, replacing two hand-rolled checks that answered wrongly | `scripts/react-compiler-scan.js` (#311) |
| 8 | Five process rules | `AGENTS.md` |
| — | **Open:** ten tests that cannot fail, as one deliberate pass | #312 |
| — | **Open:** the review robot's zero-exit on workflow PRs — recorded in #302's own evidence, never filed as an issue | #302 |

## Lessons

- **A green tick is a claim about a check, not about the code.** July's
  postmortem settled "verify state changes by observation"; this is the
  same rule pointed at CI. A check earns trust by having failed once.
- **Adjacency is the whole failure mode.** Assert on what the user gets
  — the rendered output, the generated artefact, the exit code of the
  command you actually care about — never on a mock, an input, or an
  intermediate.
- **The suite is not the build.** 1,010 green tests could not see an app
  that would not start, because no CI job bundles it. A test suite
  answers "does this code behave", never "does this artefact exist".
- **Green is a property of a branch against a tree, not of a diff.** Two
  PRs measured against the tree they were written on were both correct
  and jointly red.
- **The fix has to reach where the check runs.** The E2E guard landed on
  the release line on 10 August and is still not on `main`, so the
  nightly has now failed **twenty-two** consecutive nights. The instance
  that opened this postmortem is, at the time of writing, still red.
