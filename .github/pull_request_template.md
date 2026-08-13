<!-- What changed and why — a paragraph, in plain words. If it answers
     a device finding or a ruling, quote it. -->

## Evidence

<!-- The rule: evidence or it didn't happen. Show the change working at
     its real surface, not that the code looks right:
     - UI change → screenshot or simulator capture
     - server/data change → the actual wire response, pasted
     - behaviour change → the probe you ran and what it showed
     Delete whichever bullets don't apply — but if you're deleting all
     of them, say why the change has no observable surface. -->

### Watched failing

<!-- Required. This one has no bullet to delete.

     A passing test proves nothing until you have seen it fail for the
     right reason. Revert the fix, run the test, paste the failure,
     restore the fix. Name what you reverted, so a reader can repeat it.

     On 10 August this caught several tests that passed for the wrong
     reason — two of them because an unrelated screen happened to be on
     display. Neither would have been found by reading the diff.

     If the change genuinely has no test — a comment, a doc, a workflow
     that only a real PR can fire — say so here, and say what WOULD
     prove it and who can run that.

     Nothing in CI can hold you to this, and nothing here pretends to.
     A test that fails when its fix is reverted and a test that always
     passes are the same green tick from the outside, and any check that
     read this section could be satisfied by typing the words. The
     nearest thing to real enforcement is the shape of
     `src/test-utils/design-allowlist.ts`: a fence that fails when the
     violation is FIXED as well as when it is broken, so neither
     direction can drift quietly. Reach for that shape where the change
     allows it. -->

## Checks

<!-- Tick what's true; delete lines that don't apply. -->

- [ ] Tests cover the new behaviour (not just the happy path)
- [ ] Cached data shape changed → cache key bumped, client boundary normalises
- [ ] Touches existence classification → `scripts/audit-classification.mjs` output pasted above
- [ ] Touches an owner ruling (gallery placement, tab split, photo rule…) → the ruling is honoured or its change is called out explicitly, never buried
