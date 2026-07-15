# Landmarks — Product Spec (v1)

> Open the app, see what's interesting around you, tap anything to learn its story.

## Core flow

1. **Open** — on first launch, a friendly explanation screen describes why the app
   wants location, *then* triggers the system permission dialog (pre-permission
   priming — measurably better acceptance rates than cold-prompting).
2. **Browse** — five sections, switchable at the top of the home screen:
   - **Landmarks** — sights, monuments, museums, historic sites, parks, gardens
   - **Food** — anywhere you go to eat: restaurants, cafes, bakeries, dessert spots
   - **Drinks** — anywhere you go for the drink: pubs, bars, wine bars, coffee shops
   - **Activities** — things you do or watch: bowling, snooker, cinema, comedy,
     theatre (not gyms, spas, or stadiums — outings, not memberships or fixtures)
   - **History** — nearby Wikipedia articles for the incurably curious

   Each section is a scrollable list of nearby places sorted by proximity:
   photo card, name, Google's specific place type ("Wine Bar", "Bakery"),
   walk time, rating.
3. **Detail** — tapping a card opens a detail screen: photos, rating, address,
   opening hours, website link, and a **Story** section containing a Wikipedia
   summary when one exists (shown only when available — a cathedral has a story,
   a chain cafe usually doesn't).
4. **Refresh** — pull-to-refresh re-queries around the current position.

## Defaults & behaviors

| Decision | v1 behavior |
|---|---|
| Search radius | ~1.5 km (walkable), with a "search wider" action if results are thin |
| Sorting | Distance, nearest first |
| Location denied | Friendly message + manual "search near a place" text input |
| Data sources | Google Places API (New) + Wikipedia REST API for summaries |
| Platforms | iOS and Android from day one |
| Accounts / favorites / offline | Not in v1 — each is a candidate future issue |

## Architecture

- **The Google Places API key never ships in the app.** The app calls our own
  server endpoint, implemented as an **Expo Router API route** (e.g.
  `src/app/api/places+api.ts`) and deployed via EAS Hosting. The key lives in a
  server-side environment variable. The app bundle contains no secrets.
- Wikipedia's API is free, unauthenticated, and called for detail views (either
  from the app directly or via an API route — decided at implementation).
- One repo, one codebase: app screens and server routes live together in
  Expo Router.

## Explicitly deferred (future milestones)

- Map tab with pins
- AI "tour guide" narration on detail screens (Claude-generated)
- Favorites / saved places
- Search beyond current location
- Web platform support

## Quality bar

- Every feature PR carries its own tests and passes typecheck, lint, and test
  in CI before merge (enforced by branch ruleset on `main`).
- UI aims for modern platform-native feel using Expo UI components where they
  work on both platforms.
