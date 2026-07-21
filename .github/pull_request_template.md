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

## Checks

<!-- Tick what's true; delete lines that don't apply. -->

- [ ] Tests cover the new behaviour (not just the happy path)
- [ ] Cached data shape changed → cache key bumped, client boundary normalises
- [ ] Touches existence classification → `scripts/audit-classification.mjs` output pasted above
- [ ] Touches an owner ruling (gallery placement, tab split, photo rule…) → the ruling is honoured or its change is called out explicitly, never buried
