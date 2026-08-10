# Venture — Roadmap

Where the Storyteller goes next. The v2 roadmap this file used to hold
was written for the Google-Places era; the Storyteller pivot (PR #117)
deleted that world, and everything it planned is either shipped in
different clothes or moot. See [PRODUCT.md](PRODUCT.md) for what the
app is today.

## Shipped — the pivot and after

For orientation, not celebration: the ground the next ideas stand on.

- **The Storyteller pivot (#117–#123)** — history only, free sources
  only (Wikipedia, Historic England, Open Plaques, Geograph), zero
  marginal cost by architecture. "Hidden history nearby" stopped being
  a milestone and became the product.
- **The story, properly told** — Gemini free-tier tellings streamed
  part by part (#220), the Gazetteer (#136, #163), the full article in
  chapter folds with a link out (#221–#223, #233).
- **Saved + offline (#228, #229)** — the shelf the user fills, and one
  keep-offline switch that downloads it.
- **The walking companion** — Go mode with corridor rerouting (#213),
  the compass as an instrument (#230), on-device geocoding for
  "search near a place" when location is denied.
- **Durable AI caches (#231, #232)** — a Turso store behind the
  tellings; the cache outlives the worker.
- **CD** — API routes live on EAS Hosting; iOS 1.0 through App Store
  review.

## Candidates under discussion — not commitments

Each of these has been talked about; none is scheduled, and any of
them dies the moment a better idea shows up. The bar stays: free data,
location-first caching, no new dependencies where primitives suffice.

- **A local visited/read journal** — the stories you've stood on or
  read, kept on-device the way the Saved shelf is.
- **"After this?" story chaining** — finish a story, get the natural
  next one. The walk plan's one good idea, reborn without the plan.
- **Listening upgrades** — pause/resume, highlighting the part being
  spoken, an expo-speech voice picker.
- **Non-UK reach** — the heritage layer is UK-shaped. Candidates:
  a Wikimedia Commons geo-photo fallback where Geograph thins out,
  Wikidata heritage-designation badges (P1435) as the international
  answer to NHLE grades, and a local-language wiki merge later.

## Tried and removed — the walk plan (#100 → #168, #203)

Anchor-first walks: add stops with ＋ Walk, the app keeps order,
▶ Play the walk speaks the tellings in sequence. Solidly built —
hand-rolled reordering, persistence, an audio tour from cached
tellings — and retired anyway ("eight files, one button, zero
regrets"): a planning surface in an app whose whole promise is the
ground you're already standing on. The debris sweep (#203) took the
ghost screen with it. Lesson kept: Venture is where you stand, not an
itinerary; the fragment worth rebuilding is "After this?" — chaining
from the story you just finished, no plan required.

## Tried and removed — the Today section (#53 → #56)

A sixth pill listing AI-researched events happening nearby today. The
research worked (real market days, one-off shows, comedy nights, all
sourced) but the section failed as a *destination*: coverage is
inherently patchy day to day, first-load research took ~20s, and
tapping an event led to venue info rather than event info. Lesson
kept: AI-researched facts land when they decorate a place the user is
already looking at, and disappoint when they must carry a surface
alone. (The idea it left behind — day-aware What's On on venue
screens — went with the venue screens at the pivot.)

## Working method

Each item is a PR (or a few) through the gated pipeline: tests,
typecheck, lint, review. UI work carries simulator evidence before it
ships; data-layer work gets read line by line. Mocks before code for
anything the user will see — and then the mock is the contract.
