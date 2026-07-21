# E2E fixtures — recorded Greenwich payloads for hermetic CI

Committed, deliberate test data (NOT `.ai-cache`, which stays
gitignored). Under `E2E_FIXTURES=1` the API routes serve these
recorded payloads instead of live upstreams, because Wikipedia and
Wikidata rate-limit GitHub's shared runner IPs (E2E run 6:
`Wikipedia batch query failed with status 429` → history 502 → no
cards → red). With the flag off, all routes behave exactly as before.

Everything is **pinned to Greenwich** (51.4826, -0.0077) — the same
coordinates CI pins the simulator to. `history.json` is served for
ANY coords; `article-<slug>.json` / `retold-<slug>.json` are keyed by
slugged title (lowercase, spaces to dashes, other non-alphanumerics
stripped — see `fixtureSlug` in `src/server/fixtures.ts`). A missing
article/retold fixture yields the same 404 the live route gives.

## Re-recording

Start a dev server (`REPLAY_ONLY=1 npx expo start --port 8081`), then:

```sh
curl -s "http://localhost:8081/api/history?lat=51.4826&lng=-0.0077" > e2e-fixtures/history.json
# For each wanted title (first 8 Nearby items + Cutty Sark + Royal Observatory, Greenwich):
curl -sf "http://localhost:8081/api/article?title=Cutty%20Sark" > e2e-fixtures/article-cutty-sark.json
curl -sf "http://localhost:8081/api/retold?area=Cutty%20Sark" > e2e-fixtures/retold-cutty-sark.json
# -f skips 404s (delete the empty file if curl fails); slug = lowercased
# title, spaces → dashes, strip remaining non-alphanumerics.
```

Nearby order (which items surface first in the app) is
`thumbnailUrl && !pastTag` items first — record articles for those.
Retellings only exist where `.ai-cache` already holds one (REPLAY_ONLY
can't mint new ones); missing retolds are fine — the app falls back to
the original article.
