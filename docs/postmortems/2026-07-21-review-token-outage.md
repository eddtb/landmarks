# Post-mortem: review-token expiry jammed the merge queue

**Date:** 2026-07-21 · **Duration:** ~1h 30m (13:25–14:52 UTC) · **Severity:** internal — no user impact; all merges blocked
**Status of corrective actions:** all four complete (see bottom)

## Summary

The long-lived OAuth token powering the `claude-review` GitHub Action
(`CLAUDE_CODE_OAUTH_TOKEN` repo secret) expired. Every review check
began failing after ~30 seconds, and since the check is required,
every open PR was unmergeable. Diagnosis was slowed by two red
herrings and one silent half-fix; recovery came from a discriminating
experiment that isolated the credential by elimination. The incident
produced a rotation runbook, an automated script, a weekly canary, and
two process rules.

## Impact

- All merges blocked for the duration; a three-branch stack of
  reviewed-and-approved work accumulated behind the outage.
- No production or user-facing impact (the app ships nothing on merge;
  the dev server was unaffected).
- Follow-on cost: the branch stack later caused two rebase conflicts
  and a resurrected-lint-directive CI failure — queue outages compound.

## Timeline (UTC)

- **13:25** — First `claude-review` failure (run 29834331513), ~30s
  into the job. Subsequent runs fail identically.
- **13:25–14:30** — Diagnosis. Ruled out in order: plan usage limits
  (account dashboard showed headroom), a changed action version or
  model (workflow pinning unchanged), a platform outage.
- **~14:30** — Discriminating experiment: a local `claude -p` call
  with the developer's own login succeeded — platform healthy, session
  credentials healthy. By elimination: the repo secret itself.
- **~14:35** — First rotation attempt: `claude setup-token` run
  manually. Reported "done", but `gh secret list` still showed the
  secret's timestamp as **2026-07-02** — the update had silently not
  landed (the OAuth code was pasted into the wrong place; the final
  token was never stored).
- **14:46** — Second rotation attempt, automated: `setup-token` driven
  under `expect` in a pty; the browser sign-in was approved once by a
  human; the printed token was harvested from the pty log.
- **14:48** — New token **proved with a live authenticated call**, then
  stored: secret timestamp moved to 2026-07-21T14:48:56Z.
- **14:49** — Failed run re-fired.
- **14:52** — `claude-review` green (41s of real work, not a 30s
  choke). Merge queue unjammed; the stacked branches merged over the
  following hour.

## Root cause

The review action authenticates with a long-lived, expiring OAuth
token stored as a static repo secret. Nothing tracked its expiry, so
the first signal was the outage itself. Contributing factor: the
token is one of **three easily-confused credentials** (a dead
venue-era API key, the developer's healthy subscription login, and
this robot token), which sent diagnosis toward the wrong two first.

## What went wrong

1. **Expiry-by-surprise** — no inventory of expiring credentials, no
   monitoring. Weeks of advance warning were available and unused.
2. **Report-vs-observation** — the first fix was declared "done" on
   human report; the secret's unchanged timestamp said otherwise. An
   hour was lost to that gap.
3. **Assumed-manual recovery** — the rotation was initially handed to
   a human as a multi-step procedure on the prior that OAuth flows
   can't be driven programmatically. A 10-second probe later showed
   only one step (the browser Approve click — identity consent) is
   irreducibly human.

## What went well

- The discriminating experiment (local call with different
  credentials) isolated the fault cleanly and cheaply.
- CI's required-check gate did its job: nothing unreviewed merged
  during the outage.
- The 30-second failure signature is now a documented, recognisable
  fingerprint for this exact fault.

## Corrective actions (all complete)

| # | Action | Where |
|---|--------|-------|
| 1 | **Runbook, automated:** one-command rotation; the script live-tests the new token before storing and verifies the secret timestamp moved | `scripts/rotate-review-token.sh` (#150) |
| 2 | **Weekly canary:** exercises the same secret every Monday; opens one deduplicated issue pointing at the runbook on failure | `.github/workflows/token-canary.yml` (#153) |
| 3 | **Process rule — observation over report:** state changes are verified by inspecting the state (timestamps, live calls), never by "done" | agent memory |
| 4 | **Process rule — probe before claiming manual:** decompose a task and attempt each step before handing any of it to a human; only identity consent, physical devices, judgment, and spending are irreducibly human | agent memory |

## Lessons

- **Static secrets are a liability with a fuse.** The industry answer
  is short-lived credentials via OIDC/workload identity; where a tool
  requires a static token (as claude-review does), the fallback is
  inventory → runbook → canary. This repo now has all three.
- **Verify state changes by observation.** "Done" is a claim; a moved
  timestamp is evidence.
- **When two hypotheses die, buy evidence instead of a third guess.**
  The cheap experiment ended a wandering diagnosis.
- **Queue health is upstream of code health.** The real cost of the
  outage wasn't the 90 minutes — it was the branch stack that piled up
  behind it and the rebase hazards it seeded.
