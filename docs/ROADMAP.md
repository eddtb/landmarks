# Landmarks — v2 Roadmap

Goal: extract maximum value from the APIs we already pay for (Google Places,
Wikipedia, device location) before adding new dependencies.
See [PRODUCT.md](PRODUCT.md) for the v1 spec.

## M1 — Two-tier fetching (architecture, enables everything below)

The list currently fetches every field for all 20 places although users tap
roughly one. Split into:

- **List call**: lean field mask — id, name, location, rating, count, photo,
  primary type label. Cheaper per search.
- **`GET /api/place/[id]`** (new, Google Place Details behind it): rich fields
  for the tapped place only — full opening hours, price level, phone,
  Google Maps link, amenity/accessibility flags, all photos, reviews.
- Fixes deep-link cold starts (detail no longer depends on the session cache).

## M2 — Detail screen enrichment (UI over M1's data)

- Swipeable photo gallery (all photos, not just the first)
- Real hours: "Closes at 17:00" + expandable week schedule
- Price level badges (££)
- Tap-to-call, website, and a **Directions** button (`googleMapsUri`)
- "What people say": top reviews
- Amenity chips (outdoor seating, dog-friendly, wheelchair access…) — restrained

## M3 — Hidden history nearby (differentiator)

Wikipedia geosearch already returns historical entities with no Google
listing (old prisons, incidents, boundaries, plaques). Surface "history
within ~150 m" as its own module. Free data; nothing on Google Maps offers it.

## M4 — Walking companion

- `watchPositionAsync`: live re-sort as you move, distances tick down
- Compass heading: directional arrows to places
- Free on-device geocoding for "search near a place" (location-denied fallback)

## M5 — AI tour-guide blurbs (needs Anthropic API key)

Claude Haiku fills the description gap for places with no Wikipedia article
and no Google editorial summary (e.g. Bridget Jones's Flat). Server-side
route, per-place cache, must-decline-when-unsure prompt, labeled AI-generated.
Trust chain: Wikipedia → Google editorial → AI → nothing.

## Parallel track — Deployment (CD)

When the Apple Developer membership activates: EAS dev/preview builds,
EAS Hosting for the API routes (app stops depending on a laptop running
Metro), deploys wired into GitHub Actions.

## Working method

Each milestone is a PR (or a few) through the gated pipeline. Small,
well-scoped items get filed as GitHub issues for @claude to implement in the
cloud; architectural work happens locally with simulator verification.
