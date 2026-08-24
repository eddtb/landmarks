/**
 * Bake stage 2: every UK page → its extract, thumbnail, url and
 * area-category flag, via the SAME batch query the live compose uses
 * (wikipedia.ts findNearbyHistory), 20 pages per request.
 *
 *   node scripts/bake/sweep-extracts.ts [--in .bake/uk-pages.ndjson]
 *     [--out .bake/pages.ndjson] [--concurrency 6]
 *     [--bbox south,west,north,east] [--limit N]
 *
 * Speed policy (Edd's call): concurrency 6 with &maxlag=5 on every
 * request — maxlag is Wikipedia's own self-throttling protocol, the
 * servers answer "back off" only when actually lagged, so the sweep
 * runs fast without guessing at politeness. Retries honour Retry-After.
 *
 * Resumable: finished chunks are recorded in <out>.done and skipped on
 * the next run — but only with the SAME --in/--bbox/--limit, since
 * chunk identity is positional. Namespace filtering happens here: the
 * API reports ns per page, and only ns 0 (articles) survives.
 */
import fs from 'node:fs';

import { UserAgent } from '../../src/server/user-agent.ts';
import { BroadAreaCategories } from '../../src/utils/story-title.ts';

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const inPath = flag('in', '.bake/uk-pages.ndjson');
const outPath = flag('out', '.bake/pages.ndjson');
const concurrency = Number(flag('concurrency', '6'));
const bbox = flag('bbox', '');
const limit = Number(flag('limit', '0'));

type BatchPage = {
  pageid: number;
  ns: number;
  title: string;
  missing?: string;
  extract?: string;
  thumbnail?: { source?: string };
  fullurl?: string;
  categories?: { title: string }[];
};

type SweptPage = {
  pageId: number;
  title: string;
  extract?: string;
  thumbnailUrl?: string;
  url: string;
  area?: true;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchChunk(pageIds: number[]): Promise<SweptPage[]> {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&maxlag=5' +
    `&pageids=${pageIds.join('|')}` +
    '&prop=pageimages%7Cextracts%7Cinfo%7Ccategories&exintro=1&explaintext=1&exlimit=max' +
    `&clcategories=${encodeURIComponent(BroadAreaCategories.join('|'))}` +
    '&cllimit=max&pithumbsize=800&pilimit=max&inprop=url';

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { 'User-Agent': UserAgent },
      signal: AbortSignal.timeout(30_000),
    }).catch((error: Error) => error);

    let retryAfterMs = 0;
    if (!(response instanceof Error)) {
      if (response.ok) {
        const body = (await response.json()) as {
          error?: { code?: string };
          query?: { pages?: Record<string, BatchPage> };
        };
        if (!body.error) {
          return Object.values(body.query?.pages ?? {})
            .filter((page) => page.missing === undefined && page.ns === 0)
            .map((page) => ({
              pageId: page.pageid,
              title: page.title,
              extract: page.extract || undefined,
              thumbnailUrl: page.thumbnail?.source,
              url: page.fullurl ?? `https://en.wikipedia.org/?curid=${page.pageid}`,
              ...(page.categories?.length ? { area: true as const } : {}),
            }));
        }
        if (body.error.code !== 'maxlag') {
          throw new Error(`API error ${body.error.code} for chunk ${pageIds[0]}`);
        }
      }
      retryAfterMs = Number(response.headers.get('retry-after') ?? 0) * 1000;
    }
    if (attempt >= 8) {
      throw new Error(`chunk ${pageIds[0]} still failing after ${attempt} attempts`);
    }
    await sleep(Math.min(Math.max(retryAfterMs, 1000 * 2 ** attempt), 60_000));
  }
}

async function main(): Promise<void> {
  let coords = fs
    .readFileSync(inPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { p: number; lat: number; lng: number });

  if (bbox) {
    const [south, west, north, east] = bbox.split(',').map(Number);
    coords = coords.filter((c) => c.lat >= south && c.lat <= north && c.lng >= west && c.lng <= east);
  }
  if (limit > 0) {
    coords = coords.slice(0, limit);
  }

  const chunks: number[][] = [];
  for (let start = 0; start < coords.length; start += 20) {
    chunks.push(coords.slice(start, start + 20).map((c) => c.p));
  }

  const donePath = `${outPath}.done`;
  const done = new Set(
    fs.existsSync(donePath) ? fs.readFileSync(donePath, 'utf8').split('\n').filter(Boolean) : []
  );
  const out = fs.createWriteStream(outPath, { flags: 'a' });
  const doneLog = fs.createWriteStream(donePath, { flags: 'a' });

  const pending = chunks.map((chunk, index) => ({ chunk, index })).filter(({ index }) => !done.has(String(index)));
  console.log(
    `[sweep] ${coords.length} pages in ${chunks.length} chunks, ${pending.length} to fetch, concurrency ${concurrency}`
  );

  const started = Date.now();
  let finished = 0;
  let pages = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const { chunk, index } = pending[cursor++];
      const swept = await fetchChunk(chunk);
      for (const page of swept) {
        out.write(`${JSON.stringify(page)}\n`);
      }
      doneLog.write(`${index}\n`);
      pages += swept.length;
      finished++;
      if (finished % 25 === 0 || finished === pending.length) {
        const rate = finished / ((Date.now() - started) / 1000);
        const etaMin = (pending.length - finished) / rate / 60;
        console.log(
          `[sweep] ${finished}/${pending.length} chunks, ${pages} pages, ${rate.toFixed(1)} req/s, ~${etaMin.toFixed(0)} min left`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  await new Promise((resolve) => out.end(resolve));
  await new Promise((resolve) => doneLog.end(resolve));
  console.log(`[sweep] done: ${pages} new pages appended to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
