# Venture — Product Spec

> The history of where you stand. Open the app, see the stories around
> you, press play and let it talk you through them.

Venture began as a Google-Places venue browser. The July 2026 cost
incidents (see git history around PRs #103–#116) proved that model
untenable on free tiers, and the product pivoted to the **Storyteller**
(PR #117): history only, free sources only, zero marginal cost by
architecture rather than by restraint.

## Core flow

1. **Open** — a friendly explanation screen describes why the app wants
   location, *then* triggers the system permission dialog. Denied
   location degrades to a manual "search near a place" input (on-device
   geocoding).
2. **Nearby** — the stories of where you stand, sorted by distance and
   capped at 40: photo card, title, the hook (the extract's first
   sentence), and a meta line — `2 min walk · Wikipedia · 🔊`. Stories
   come from four free sources, merged one-place-one-card:
   - **Wikipedia** — the backbone: articles physically near the user,
     including things that no longer exist
   - **Historic England** — listed buildings from the National Heritage
     List (keyless ArcGIS service), with their grades
   - **Open Plaques** — the blue plaques and their inscriptions
   - **Geograph** (free key) — CC BY-SA photographs for stories the
     other sources left unillustrated, credited at display
3. **The story screen** — large title, Compass (bearing + distance
   modal), ＋ Walk, and STORY: the **telling** — a ~one-minute spoken
   narration written once by the free-tier model from the source text,
   cached 30 days, spoken by the device (expo-speech) — above the
   source extract and its attribution link.
4. **Walks** — anchor-first: the user adds stops (＋ Walk anywhere, or
   the "After this?" suggestions), the app keeps order — walking legs,
   ↑↓ reordering, persistence until Clear. **▶ Play the walk** speaks
   the stops in sequence: an audio tour assembled from cached tellings.

## Defaults & behaviors

| Decision | Behavior |
|---|---|
| Search radius | ~1.5 km Wikipedia, ~1 km heritage sources (walkable) |
| Sorting | Distance, nearest first; 40-story cap |
| Location denied | Manual "search near a place" (on-device geocode) |
| Data sources | Wikipedia, Historic England NHLE, Open Plaques, Geograph, Gemini free tier (tellings only) |
| Cost model | Zero marginal cost: keyless/free-keyed upstreams; AI is free-tier, breaker-fenced (300 calls/day), disk-cached 30d |
| Platforms | iOS and Android |
| Accounts / favorites / offline | Not in v1 |

## Architecture

- One repo, one codebase: app screens and **Expo Router API routes**
  live together. The app calls `/api/history` (source composition) and
  `/api/telling` (narration); no upstream keys ship in the bundle.
- `/api/history` composes all four sources with `allSettled`: Wikipedia
  is the backbone; any heritage source failing degrades to fewer
  stories, never to an error.
- Tellings are written by Gemini (free tier, ungrounded — the source
  extract rides in with the request) behind a call-count breaker, and
  cached on disk for 30 days. `REPLAY_ONLY=1` dev servers refuse new
  AI calls entirely and serve only cached tellings.
- The walk persists on-device (AsyncStorage, session-fallback when the
  native module is absent).

## Explicitly deferred

- Map tab with pins
- Favorites / saved places
- Search beyond current location
- Web platform support
- Richer telling voices (expo-speech voice selection)

## Quality bar

- Every feature PR carries its own tests and passes typecheck, lint, and
  test in CI before merge (enforced by branch ruleset on `main`).
- Live verification over trust: new upstream parses are probed on the
  wire and the recorded responses become test fixtures.
- UI aims for modern platform-native feel using Expo UI components where
  they work on both platforms.
