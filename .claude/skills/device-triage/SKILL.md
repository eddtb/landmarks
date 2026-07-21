---
name: device-triage
description: The device-review loop — turn Edd's on-phone findings into diagnosed, verified, merged PRs. Use whenever Edd reports something from his phone ("X is broken", "Y should be Z", "why does…").
---

# Device triage

Edd tests on his phone and reports findings; each becomes evidence,
then a fix, then a PR. This loop shipped 20+ PRs in a day when run
well. Its rules were each paid for by a specific failure.

## 1. Read the finding

- **Two plausible readings → restate or ask before building.** One
  option-sheet question is cheaper than a build-review-rebuild loop
  (the featured-rail misread). For UI asks with real alternatives,
  offer 2–3 options with previews.
- **Scope is exactly what was asked.** Never move, remove, or "improve"
  neighbouring things unasked (the count-line lesson). Owner rulings
  change explicitly or not at all.
- Check the trivial explanation first: is the phone even looking at
  merged main? Metro serves this working directory's branch — if the
  serving tree is on a feature branch, the report may describe stale
  or unmerged code, not a bug.

## 2. Diagnose with evidence before fixing

Reproduce at the real surface, not in your head:
- Wire: `curl -s "http://localhost:8081/api/…"` (history needs `lat`/`lng`,
  article/retold take `title`/`area`; `fresh=1` bypasses bucket cache).
- Screen: the `verifier-simulator` skill.
- State: inspect `.ai-cache/*.json` directly — cached verdicts explain
  many "bugs" (and stale caches ARE the bug often enough that shape
  changes always version-bump the cache name).
- When two hypotheses die, buy evidence with a discriminating
  experiment instead of a third guess.

## 3. Fix on a branch, gate locally

- Branch per finding; small PRs. `main` is the serving tree — return
  to it after pushing so Edd's phone always shows merged reality.
- The pre-push hook runs typecheck + lint + jest and blocks bad
  pushes. Fix what it says; never `--no-verify` around a real failure.
- Server caching rules: a failure result must never be cached as a
  verdict (couldn't-try ≠ tried-and-failed); keyless upstreams get
  sequential politeness, not parallel hammering.

## 4. Verify at the surface, then ship

- Evidence in the PR body per the template: screenshots for UI, wire
  responses for server, probe transcripts for behaviour. The reviewer
  should never have to take the description's word.
- Arm into the merge chain: `gh pr merge <n> --auto --squash --delete-branch`.
  The chain (`merge-chain.yml`) advances armed PRs oldest-first on
  every push to main; conflicts (DIRTY) are yours to rebase — the
  chain rightly won't.
- Report to Edd: outcome first, then what the evidence showed. If the
  finding revealed a bug-class (not just an instance), say so and
  consider an agent sweep for its siblings.
