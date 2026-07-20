# Venture

**The history of where you stand.** Open the app and it shows the
stories around you — the vanished palace, the blue plaque, the Grade I
church — and speaks them aloud, about a minute each, as you walk.

Built with Expo SDK 56 (expo-router, API routes, expo-speech) as a
learning project in CI/CD, testing, and AI-assisted workflows — and,
after a costly first act as a Google-Places venue browser, in **zero-
marginal-cost architecture**: every upstream is free, every AI call is
free-tier and breaker-fenced, and the caches are designed to outlive
the process.

## What it does

- **Nearby** — stories within a walk, merged one-place-one-card from
  Wikipedia, Historic England's National Heritage List, and Open
  Plaques, with Geograph photographs (CC BY-SA, credited) for the
  stories nobody illustrated.
- **The telling** — press 🔊 Listen and the phone speaks a ~one-minute
  narration, written once per story by Gemini's free tier from the
  source text alone, cached 30 days. Hook first, no invention, sources
  linked beside it.
- **Walks** — build a walking tour with ＋ Walk, reorder with ↑↓, and
  **▶ Play the walk**: the tellings in sequence, an audio tour of
  ground you're actually covering.
- **Compass** — a bearing-and-distance modal that works for buildings
  that no longer exist.

## Development

```bash
npm install
REPLAY_ONLY=1 npx expo start   # dev servers can't spend money — see AGENTS.md
```

Runs in a dev build (expo-speech and AsyncStorage are native modules);
`npm test` / `npm run lint` / `npx tsc --noEmit` mirror CI, which is
keyless — unit tests are mocked, live parses are recorded fixtures.

Docs: [product spec](docs/PRODUCT.md) · [design system](docs/DESIGN.md)
· [agent/cost rules](AGENTS.md)
