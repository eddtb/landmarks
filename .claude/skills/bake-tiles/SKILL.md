---
name: bake-tiles
description: Rebake the Venture tile set — the four local stages in scripts/bake/ (geo_tags dump → extract sweep → Wikidata facts sweep → tiles) — smoke-check it, and publish it to the eddtb/venture-tiles GitHub Pages repo. Use whenever the published tiles need refreshing, whenever the bake scripts change, whenever someone asks how the feed's data gets updated, or whenever a story is missing or wrong on a phone and "rebake" is the answer. There is deliberately NO CI job for this (docs/adr/0003) — this runbook IS the job.
---

# Baking the tiles

Nearby reads pre-composed tiles off a CDN (docs/adr/0001). This is the
whole procedure for making a fresh set and publishing it. It runs from a
checkout on a laptop, on purpose: a small project's data changes on a
timescale of months, and a scheduled pipeline would cost more than it
saves (docs/adr/0003). Rerun it when someone deems it necessary.

Budget an hour, most of it Wikipedia's answering speed. Nothing here
spends money or AI quota — every upstream is keyless and unmetered.

## Before starting

1. Be on an up-to-date `main` with a clean tree. The stages import
   `src/utils/tiles.ts`, `story-title.ts` and `existence.ts` directly,
   so the bake asks the same questions the app does — from the same
   commit.
2. Keep the working directory out of git WITHOUT touching `.gitignore`:
   ```bash
   grep -qxF ".bake/" .git/info/exclude || echo ".bake/" >> .git/info/exclude
   ```
   `@expo/fingerprint` hashes `.gitignore`. Adding `.bake/` there moved
   the native fingerprint once (24 Aug 2026) and closed the OTA road
   until it was reverted. `info/exclude` does the same job unseen.
3. Have the tiles repo cloned at `.bake/tiles` (the writer targets it):
   ```bash
   [ -d .bake/tiles/.git ] || git clone -q https://github.com/eddtb/venture-tiles.git .bake/tiles
   ```

## The four stages

Run each in the foreground, or in the background WITHOUT a pipe. A bake
run as `node … | grep …` reports grep's exit code, not node's — a crash
wore a green 0 for an hour that way. Read the status of the command you
care about.

```bash
# 1. The dump → every UK-and-Ireland page with coordinates (~15 min,
#    mostly the 53 MB download at Wikimedia's pace; the parse is ~1 min)
node scripts/bake/parse-geo-tags.ts
#    expect: ~2.8 M coordinates → ~120k pages → .bake/uk-pages.ndjson

# 2. Extracts, thumbnails, urls, area categories — the SAME batch query
#    the app uses, 20 pages a request, concurrency 6, maxlag honoured
#    (~40 min; resumable — rerun to continue from <out>.done)
node scripts/bake/sweep-extracts.ts
#    expect: ~118k articles → .bake/pages.ndjson

# 3. Wikidata existence facts — tags, event and area verdicts, 50 titles
#    a POST (~15 min; resumable the same way). Deliberately NO maxlag:
#    Wikidata folds the SPARQL updater's backlog into its maxlag figure,
#    a brake meant for editing bots; a read-only sweep waited an hour on
#    it for nothing. Modest concurrency + Retry-After is the politeness
#    a read owes.
node scripts/bake/sweep-facts.ts
#    expect: ~8.4k verdicts → .bake/facts.ndjson

# 4. Bin, gate, cap, write (seconds)
node scripts/bake/write-tiles.ts
#    expect: ~14.9k tiles, ~101k stories, ~95 MB raw → .bake/tiles/v1/
#    If it WARNS about a missing facts file, stop: a factless bake ships
#    events into Nearby and strips every pastTag.
```

A smoke run on one box costs a minute and proves the road before the
hour: `--bbox 51.44,-0.06,51.52,0.04` on stages 2 and 3 (with
`--out .bake/pages-greenwich.ndjson` / `facts-greenwich.ndjson`), then
stage 4 with `--pages`/`--facts`/`--out .bake/tiles-greenwich`.

## Smoke-check the bake before publishing

The recorded Greenwich feed is ground truth the suite already trusts.
Every Wikipedia story in it must come out of the covering cells:

```bash
python3 - <<'EOF'
import json, math, os
def ci(v): return math.floor(round(v / 0.05, 6))
def key(la, lo): return f"{ci(la)*0.05:.2f},{ci(lo)*0.05:.2f}"
lat, lng = 51.482, -0.008
sl = 1500/111320; sn = 1500/(111320*math.cos(math.radians(lat)))
cells = {key(a, b) for a in (lat-sl, lat, lat+sl) for b in (lng-sn, lng, lng+sn)}
tiled = {}
for k in cells:
    p = f'.bake/tiles/v1/{k}.json'
    if os.path.exists(p):
        for s in json.load(open(p))['stories']: tiled[s['pageId']] = s
fx = [i for i in json.load(open('e2e-fixtures/history.json'))['items'] if i['pageId'] < 2_000_000_000]
hit = sum(1 for i in fx if i['pageId'] in tiled)
sil = next((s.get('event') for s in json.load(open('.bake/tiles/v1/51.50,0.00.json'))['stories'] if s['title'] == 'Silvertown explosion'), None)
print(f"Greenwich fixture: {hit}/{len(fx)}   Silvertown explosion event={sil}")
assert hit == len(fx) and sil is True
EOF
```

`102/102` and `event=True` is a pass. Anything else means the bake is
wrong, not the fixture — do not publish.

## Publish

```bash
cd .bake/tiles && git add -A && git commit -q -m "Bake of $(date +%F): $(python3 -c "import json;m=json.load(open('v1/manifest.json'));print(f\"{m['tiles']:,} tiles, {m['stories']:,} stories\")")" && git push -q origin main && cd -
```

Pages redeploys in about a minute. Verify from the CDN, not the disk:

```bash
curl -s https://eddtb.github.io/venture-tiles/v1/manifest.json | python3 -c "import json,sys; print(json.load(sys.stdin)['generatedAt'])"
curl -s "https://eddtb.github.io/venture-tiles/v1/51.50,0.00.json" | grep -c '"Silvertown explosion","coordinates":{[^}]*},"extract":"[^"]*","thumbnailUrl":"[^"]*","url":"[^"]*","event":true' 
```

The first must print today's timestamp; the second must print `1`.
Phones pick the new bake up on their next feed ask (an hour's bucket
TTL at most) — no OTA is needed for a rebake, because the client passes
through every field a tile carries.

## The versioning rule (docs/adr/0002)

Adding optional fields is a rebake in place under `v1`. Renaming or
removing a field, or changing the grid, is a NEW path (`v2/`) plus a
client release — `v1` is never mutated under phones still reading it.
