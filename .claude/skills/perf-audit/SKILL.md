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

**Baseline (2026-07-22): entry Hermes bundle 3856 KB; total export 4.2 MB.**
(Previous: 2026-07-16, 3548 KB / 3.9 MB. The +8.7% is explained —
async-storage, expo-speech, expo-audio plus five features — and sits
under the 10% gate.) More than ~10% growth without a feature explaining
it is a finding. To attribute growth, re-export with Atlas and inspect
the module treemap:

```bash
EXPO_ATLAS=1 npx expo export --platform ios --output-dir /tmp/perf-export
npx expo-atlas /tmp/perf-export/atlas.jsonl
```

Look for: duplicate dependencies, accidentally-bundled dev tooling, large
JSON, unused locales.

## 2 · API route latency (the app feels as fast as its server)

Boot the dev server (`REPLAY_ONLY=1` — see AGENTS.md), then time the
critical routes (Deptford test coordinates):

```bash
time curl -s "http://localhost:8081/api/history?lat=51.478&lng=-0.0192" -o /dev/null
```

**Budgets (measured 2026-07-22):**

- `/api/history` warm (same 3 dp bucket) ≤ 50ms — measured 7-9ms.
  Cold compose is 5-9s (Wikipedia + Historic England + Open Plaques +
  Geograph fan-out) — **known debt**, not a fresh finding; log it only
  if it worsens. A sparse rural cold compose (widened search) runs ~3s.
- `/api/article` light ≤ 0.5s cold (measured 0.36s); full article warm
  ≤ 50ms.
- `/api/story` ≤ 0.3s cold — it has **no server cache** (known); the
  client's item cache absorbs repeats.
- REPLAY_ONLY refusal (uncached AI ask) ≤ 50ms — the budget breaker
  must refuse instantly, never hang.

If a warm repeat call is slow, the globalThis cache is broken again (it
has broken before: the dev server re-evaluates route modules per
request; server caches MUST live on globalThis).

## 3 · Render hot paths (check these first, they carry the app)

- **Story feed FlatList** (`section-screen.tsx`): `HistoryCard` images
  must use `expo-image` with `contentFit` (they do — keep it). If
  scroll stutters, profile before touching code.
- **GPS-driven updates**: `useLocation` ticks every ~10m move; the
  data hooks (`use-history`, `use-area-name`) quantize their effect
  deps to the server's 3 dp (~111m) bucket, so a tick inside a bucket
  must fire no fetch and no feed re-render — a re-render storm while
  walking means the quantization or the setState bail regressed.
- **Compass/needle**: rotation runs on the UI thread via reanimated
  `withTiming` — if the needle stutters, look for accidental JS-thread
  work in `PointerDial`, not reanimated itself.
- **Persisted caches** (`persisted-cache.ts`): write-backs are
  debounced, fold storage once per process, and every named map is
  capped — an uncapped or per-write-parsing store shows up as JS-thread
  stalls that grow with days of use.
- **React Compiler is ON** (`experiments.reactCompiler`) — memoisation is
  largely automatic; do not hand-add `useMemo`/`useCallback` without
  profiler evidence.

To profile: dev menu → toggle Performance Monitor (JS FPS while
scrolling the feed should hold near 60), or React DevTools profiler for
commit counts.

## 4 · App-specific invariants (cheap to check, expensive when broken)

- A warm list re-dress does **zero** photo lookups — re-serving a
  cached feed must not refire Commons/Geograph image legs. Watch the
  dev-server logs on a repeat call.
- The sparse-area widen fires only below **25 merged items** — a dense
  city feed running the widened search is a regression.
- With the fixtures flag off, responses are **byte-identical** to the
  fixtureless path — fixtures must never leak into real serving.
- AI is tap-gated: no telling/retelling calls fire from the feed list;
  a story's telling composes only on the user's tap.

## 5 · Report format

Lead with a verdict (healthy / regression found), then per-section
numbers vs baseline, then any fixes as separate proposals — measurement
and remediation are different PRs.

## Production (post-deployment)

Once the API routes are on EAS Hosting and builds ship via EAS, prefer
the official skills for live data: `eas-observe` (route/event/version
metrics) and `eas-update-insights` (crash rates, launch counts, payload
size). This skill remains the local/pre-production half.
