---
name: perf-audit
description: Run a performance audit of the Venture app — bundle size vs baseline, render hot paths, API route latency, cache behaviour — and report regressions with evidence. Use when asked about performance, slowness, bundle size, or app speed.
---

# Venture performance audit

Audit the app against its recorded baselines and its known hot paths.
Report findings with numbers, not impressions; every claim of "slower"
or "fine" needs a measurement next to it. Update baselines in this file
(with date) when they legitimately change.

## 1 · Bundle size (regression check)

```bash
npx expo export --platform ios --output-dir /tmp/perf-export
find /tmp/perf-export -name "*.hbc" -exec du -k {} +
```

**Baseline (2026-07-16): entry Hermes bundle 3548 KB; total export 3.9 MB.**
More than ~10% growth without a feature explaining it is a finding. To
attribute growth, re-export with Atlas and inspect the module treemap:

```bash
EXPO_ATLAS=1 npx expo export --platform ios --output-dir /tmp/perf-export
npx expo-atlas /tmp/perf-export/atlas.jsonl
```

Look for: duplicate dependencies, accidentally-bundled dev tooling, large
JSON, unused locales.

## 2 · API route latency (the app feels as fast as its server)

Boot the dev server, then time the critical routes (Deptford test
coordinates):

```bash
time curl -s "http://localhost:8081/api/places?lat=51.478&lng=-0.0192&category=drink" -o /dev/null
```

**Budgets:** `/api/places` ≤ ~2.5s cold (two Google calls in parallel +
routing); cached AI routes (`/api/whats-on`, `/api/busyness`,
`/api/blurb`) ≤ 50ms on repeat calls with identical params — if a repeat
call is slow, the globalThis cache is broken again (it has broken before:
dev server re-evaluates route modules per request; caches MUST live on
globalThis).

## 3 · Render hot paths (check these first, they carry the app)

- **Browse FlatList**: 40 photo cards. Each `PlaceCard` image must use
  `expo-image` with `contentFit` (it does — keep it); cards must not
  re-render on GPS ticks except through the `livePlaces` memo in
  `src/app/index.tsx`. If scroll stutters, profile before touching code.
- **GPS-driven updates**: `useLocation` ticks every ~10m move; distance
  re-sorting runs through `useMemo` keyed on `[state, center]`. A
  re-render storm here shows as browse jank while walking.
- **Compass/needle**: rotation runs on the UI thread via reanimated
  `withTiming` — if the needle stutters, look for accidental JS-thread
  work in `PointerDial`, not reanimated itself.
- **React Compiler is ON** (`experiments.reactCompiler`) — memoisation is
  largely automatic; do not hand-add `useMemo`/`useCallback` without
  profiler evidence.

To profile: dev menu → toggle Performance Monitor (JS FPS while
scrolling browse should hold near 60), or React DevTools profiler for
commit counts.

## 4 · App-specific invariants (cheap to check, expensive when broken)

- Section switches must NOT refetch: places are session-cached per
  category+grid. Watch the dev-server logs while switching pills — new
  Google calls on every switch is a regression.
- Nearby search is exactly **2 Google calls per category fetch**
  (DISTANCE + POPULARITY). More means the dual-rank merge regressed.
- Photos route through `/api/photo` (302 to Google's CDN — no bytes
  proxied); Street View streams bytes by design (key privacy). Photo
  bytes flowing through our server would be a perf and cost bug.
- AI features are tap-gated: no What's On/busyness/blurb calls should
  fire from the browse list.

## 5 · Report format

Lead with a verdict (healthy / regression found), then per-section
numbers vs baseline, then any fixes as separate proposals — measurement
and remediation are different PRs.

## Production (post-deployment)

Once the API routes are on EAS Hosting and builds ship via EAS, prefer
the official skills for live data: `eas-observe` (route/event/version
metrics) and `eas-update-insights` (crash rates, launch counts, payload
size). This skill remains the local/pre-production half.
