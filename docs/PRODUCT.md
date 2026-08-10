# Venture — Product Spec

> The history of where you stand. Open the app, see the stories around
> you, press play and let it talk you through them.

Venture began as a Google-Places venue browser. The July 2026 cost
incidents (see git history around PRs #103–#116) proved that model
untenable on free tiers, and the product pivoted to the **Storyteller**
(PR #117): history only, free sources only, zero marginal cost by
architecture rather than by restraint.

## Core flow

1. **Open** — one brand gate (the one door, #209): what the app is,
   one enable-location button, *then* the system permission dialog.
   Denied location degrades to a manual "Search near a place" input
   (on-device geocoding) — Exploring mode, honestly labelled.
2. **Nearby** — the stories of where you stand, sorted by distance.
   The feed composes deep — up to 150 stories; the list virtualises —
   so the walk never runs out: photo card, title, the hook (the
   extract's first sentence), and a meta line — `2 min walk ·
   Wikipedia`. Stories come from four free sources, merged
   one-place-one-card:
   - **Wikipedia** — the backbone: articles physically near the user,
     including things that no longer exist
   - **Historic England** — listed buildings from the National Heritage
     List (keyless ArcGIS service), with their grades
   - **Open Plaques** — the blue plaques and their inscriptions
   - **Geograph** (free key) — CC BY-SA photographs for stories the
     other sources left unillustrated, credited at display
3. **The story screen** — hero photo, large title, then the journey
   controls: violet **Go** (guided walk — live route, the dial,
   reroute only on leaving the corridor), **Compass** (the instrument
   dial, modal), **Save**. Then STORY: the **telling** — a ~one-minute
   narration written by the free-tier model from the source text,
   streamed part by part, cached 30 days, spoken on demand
   (expo-speech) — above the full article in chapter folds and a
   "Read more on Wikipedia" link out to the record.
4. **Saved** — the shelf the user fills: Save on any story keeps it,
   newest first. One **Keep offline** switch downloads the shelf —
   story, telling, hero — so it answers with no signal; switching it
   off purges the downloads and keeps the saves.
5. **History** — the archive as Gazetteer: the area's own illustrated
   story, retold, with the relics of its ground beneath — photo
   optional, honest tags, vanished things included.

## Defaults & behaviors

| Decision | Behavior |
|---|---|
| Search radius | ~1.5 km Wikipedia, ~1 km heritage sources (walkable); sparse areas widen Wikipedia to 3 km and the feed says so |
| Sorting | Distance, nearest first; deep feed capped at 150 |
| Location denied | Manual "Search near a place" (on-device geocode) |
| Data sources | Wikipedia, Historic England NHLE, Open Plaques, Geograph, Gemini free tier (tellings only) |
| Cost model | Zero marginal cost: keyless/free-keyed upstreams; AI is free-tier, breaker-fenced (300 calls/day), cached 30d in a durable store |
| Platforms | iOS and Android |
| Accounts | None — nothing to sign into in v1 |

## Architecture

- One repo, one codebase: app screens and **Expo Router API routes**
  live together, and the routes deploy to EAS Hosting. The app calls
  the route family — `/api/history` (source composition),
  `/api/article`, `/api/story`, `/api/telling` and `/api/retold` (the
  narrations), `/api/route` (walking legs) — and no upstream keys ship
  in the bundle.
- `/api/history` composes all four sources with `allSettled`: Wikipedia
  is the backbone; any heritage source failing degrades to fewer
  stories, never to an error.
- Tellings are written by Gemini (free tier, ungrounded — the source
  extract rides in with the request) behind a call-count breaker, and
  cached 30 days in a durable Turso store that survives worker
  recycles. `REPLAY_ONLY=1` dev servers refuse new AI calls entirely
  and serve only cached tellings.
- The shelf persists on-device (AsyncStorage, session-fallback when
  the native module is absent); offline packs live beside it.

## Explicitly deferred

- Map tab with pins (Go mode draws its route; there is no browse map)
- Accounts / sign-in
- Web platform support
- Richer telling voices (expo-speech voice selection)

Further ideas — a visited journal, story chaining, non-UK reach — are
candidates in [ROADMAP.md](ROADMAP.md), not commitments.

## Quality bar

- Every feature PR carries its own tests and passes typecheck, lint, and
  test in CI before merge (enforced by branch ruleset on `main`).
- Live verification over trust: new upstream parses are probed on the
  wire and the recorded responses become test fixtures.
- UI aims for modern platform-native feel using Expo UI components where
  they work on both platforms.
