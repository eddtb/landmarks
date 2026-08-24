/**
 * Bake stage 2b: every swept article → its Wikidata existence facts,
 * asking the IDENTICAL question the live compose asks (the pure core in
 * src/utils/existence.ts): pastTag ("Demolished 1936"), the event
 * verdict that keeps happenings out of Nearby (Edd's ruling), and the
 * broad-area verdict.
 *
 *   node scripts/bake/sweep-facts.ts [--in .bake/pages.ndjson]
 *     [--out .bake/facts.ndjson] [--concurrency 4]
 *     [--bbox south,west,north,east] [--coords .bake/uk-pages.ndjson]
 *
 * Batches of 50 titles (wbgetentities' cap) by POST — a GET of 50 long
 * titles can overflow the URL; the compose's 15-a-time was an edge
 * timeout constraint that does not bind a bake. maxlag rides on every
 * request; resumable via <out>.done exactly like sweep-extracts (same
 * caveat: chunk identity is positional, keep the filters identical
 * across resumes). Only non-empty verdicts are written — honest
 * silence takes no disk.
 */
import fs from 'node:fs';

import { UserAgent } from '../../src/server/user-agent.ts';
import type { EntityClaims } from '../../src/utils/existence.ts';
import { claimIds, existenceTag, isAreaArticle, isEventArticle } from '../../src/utils/existence.ts';

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const inPath = flag('in', '.bake/pages.ndjson');
const coordsPath = flag('coords', '.bake/uk-pages.ndjson');
const outPath = flag('out', '.bake/facts.ndjson');
const concurrency = Number(flag('concurrency', '4'));
const bbox = flag('bbox', '');

const Endpoint = 'https://www.wikidata.org/w/api.php';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ action: 'wbgetentities', format: 'json', maxlag: '5', ...params });
  let lastFailure = 'no attempt made';
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(Endpoint, {
      method: 'POST',
      headers: { 'User-Agent': UserAgent },
      body,
      signal: AbortSignal.timeout(60_000),
    }).catch((error: Error) => error);

    let retryAfterMs = 0;
    if (response instanceof Error) {
      lastFailure = `${response.name}: ${response.message}${response.cause ? ` (${String(response.cause)})` : ''}`;
    } else if (!response.ok) {
      lastFailure = `HTTP ${response.status}`;
    }
    if (!(response instanceof Error)) {
      if (response.ok) {
        const parsed = (await response.json()) as { error?: { code?: string } };
        if (!parsed.error) {
          return parsed as Record<string, unknown>;
        }
        // Every API error retries, not just maxlag: Wikidata throws
        // transient internal_api_error under load, and one of those
        // killed a 40-minute sweep at chunk 1082. The attempt cap below
        // still turns a persistent error into a loud failure.
        if (parsed.error.code !== 'maxlag') {
          console.warn(`[facts] retrying after Wikidata error ${parsed.error.code}`);
        }
        lastFailure = `API error ${parsed.error.code}`;
      }
      retryAfterMs = Number(response.headers.get('retry-after') ?? 0) * 1000;
    }
    if (attempt >= 8) {
      throw new Error(
        `Wikidata still failing after 8 attempts — last failure: ${lastFailure}; params: ${
          (params.titles ?? params.ids ?? '').slice(0, 120)
        }`
      );
    }
    if (attempt >= 2) {
      console.warn(`[facts] attempt ${attempt + 1} failed (${lastFailure}), backing off`);
    }
    await sleep(Math.min(Math.max(retryAfterMs, 1000 * 2 ** attempt), 60_000));
  }
}

type EntitiesBody = {
  entities?: Record<string, { claims?: EntityClaims; sitelinks?: { enwiki?: { title?: string } } }>;
};
type LabelsBody = { entities?: Record<string, { labels?: { en?: { value?: string } } }> };

// Class labels are stable vocabulary and small — one shared map for the
// whole sweep. A QID two workers request at once is fetched twice and
// written identically; wasteful, never wrong.
const labels = new Map<string, string>();

async function resolveLabels(claimsByTitle: Map<string, EntityClaims>): Promise<void> {
  const unseen = new Set<string>();
  for (const claims of claimsByTitle.values()) {
    for (const id of [...claimIds(claims, 'P31'), ...claimIds(claims, 'P5816')]) {
      if (!labels.has(id)) {
        unseen.add(id);
      }
    }
  }
  const ids = [...unseen];
  for (let start = 0; start < ids.length; start += 50) {
    const body = (await api({
      ids: ids.slice(start, start + 50).join('|'),
      props: 'labels',
      languages: 'en',
    })) as LabelsBody;
    for (const [qid, entity] of Object.entries(body.entities ?? {})) {
      labels.set(qid, entity.labels?.en?.value ?? '');
    }
  }
}

async function sweepChunk(titles: string[]): Promise<Map<string, object>> {
  const body = (await api({
    sites: 'enwiki',
    titles: titles.join('|'),
    props: 'claims|sitelinks',
    sitefilter: 'enwiki',
  })) as EntitiesBody;

  const claimsByTitle = new Map<string, EntityClaims>();
  for (const entity of Object.values(body.entities ?? {})) {
    const title = entity.sitelinks?.enwiki?.title;
    if (title && entity.claims) {
      claimsByTitle.set(title, entity.claims);
    }
  }
  await resolveLabels(claimsByTitle);

  // Resolve request-case → response-case exactly as the compose does
  const resolved = new Map([...claimsByTitle.keys()].map((title) => [title.toLowerCase(), title]));
  const facts = new Map<string, object>();
  for (const requested of titles) {
    const actual = resolved.get(requested.toLowerCase());
    const claims = actual ? claimsByTitle.get(actual) : undefined;
    if (!claims) {
      continue;
    }
    const tag = existenceTag(claims, labels);
    const event = isEventArticle(claims);
    const area = isAreaArticle(claims);
    if (tag || event || area) {
      facts.set(requested, {
        title: requested,
        ...(tag ? { tag } : {}),
        ...(event ? { event: true } : {}),
        ...(area ? { area: true } : {}),
      });
    }
  }
  return facts;
}

async function main(): Promise<void> {
  let pages = fs
    .readFileSync(inPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { pageId: number; title: string });

  if (bbox) {
    const [south, west, north, east] = bbox.split(',').map(Number);
    const coords = new Map(
      fs
        .readFileSync(coordsPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { p: number; lat: number; lng: number })
        .map((c) => [c.p, c])
    );
    pages = pages.filter((page) => {
      const at = coords.get(page.pageId);
      return at && at.lat >= south && at.lat <= north && at.lng >= west && at.lng <= east;
    });
  }

  const chunks: string[][] = [];
  for (let start = 0; start < pages.length; start += 50) {
    chunks.push(pages.slice(start, start + 50).map((page) => page.title));
  }

  const donePath = `${outPath}.done`;
  const done = new Set(
    fs.existsSync(donePath) ? fs.readFileSync(donePath, 'utf8').split('\n').filter(Boolean) : []
  );
  const out = fs.createWriteStream(outPath, { flags: 'a' });
  const doneLog = fs.createWriteStream(donePath, { flags: 'a' });

  const pending = chunks
    .map((chunk, index) => ({ chunk, index }))
    .filter(({ index }) => !done.has(String(index)));
  console.log(
    `[facts] ${pages.length} titles in ${chunks.length} chunks, ${pending.length} to ask, concurrency ${concurrency}`
  );

  const started = Date.now();
  let finished = 0;
  let written = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const { chunk, index } = pending[cursor++];
      const facts = await sweepChunk(chunk);
      for (const fact of facts.values()) {
        out.write(`${JSON.stringify(fact)}\n`);
      }
      doneLog.write(`${index}\n`);
      written += facts.size;
      finished++;
      if (finished % 50 === 0 || finished === pending.length) {
        const rate = finished / ((Date.now() - started) / 1000);
        const etaMin = (pending.length - finished) / rate / 60;
        console.log(
          `[facts] ${finished}/${pending.length} chunks, ${written} verdicts, ${rate.toFixed(1)} req/s, ~${etaMin.toFixed(0)} min left`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  await new Promise((resolve) => out.end(resolve));
  await new Promise((resolve) => doneLog.end(resolve));
  console.log(`[facts] done: ${written} verdicts appended to ${outPath} (${labels.size} class labels resolved)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
