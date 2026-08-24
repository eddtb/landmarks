# Nearby is a published dataset of tiles, not a live compose

Until August 2026 the Nearby feed was composed at request time on the
edge from four live upstreams, nine to twelve serial network stages
behind one spinner, budgeted at 5–9 s and observed at 17 s, because
every worker isolate forgot the previous compose within minutes. The
content changes on a timescale of months. We moved composition to
publish time: a bake turns Wikipedia's geo_tags dump and an extract
sweep into one JSON tile per 0.05° cell, published as static files on
GitHub Pages, and the phone fetches the cells its walk radius touches
and composes on device (~0.5 s cold, ~87 KB). The server keeps only what
is genuinely dynamic — the three Gemini routes and the walking-route
proxy. The compose path, its concurrency clamps and the feed's durable
store are being deleted rather than kept as a fallback: two roads are
two truths, and a visible dead store beats a 17-second surprise.

## Considered options

- **Keep live compose, make it progressive** (paint the backbone first,
  stream the rest). Cheaper, but a cold miss in a new area stays 5+ s
  because the fan-out itself is untouched.
- **On-device dataset** (a downloadable regional gazetteer). Instant and
  offline, but a bigger app, a sync story, and a larger pivot than the
  problem needed. Tiles leave this open as a later extension.

## Consequences

Upstream failures now break a bake, which is rerun, instead of a feed in
someone's hand. Non-Wikipedia sources (Historic England, Open Plaques,
Geograph) are absent from v1 tiles pending a decision after real walks;
they would return as bake-time joins, never as request-time calls.
