import { diskBackedMap } from '@/server/ai-cache';
import { UserAgent } from '@/server/user-agent';
import {
  AreaClassIds,
  claimIds,
  claimYear,
  EventClassIds,
  existenceTag,
  isAreaArticle,
  isEventArticle,
  type EntityClaims,
} from '@/utils/existence';

/**
 * Structured existence facts. The grammar experiments (#135, #137)
 * proved that past-tense prose cannot tell a demolished palace from a
 * dissolved institution in a standing building — Wikidata can, and
 * every claim it yields carries its own evidence:
 *
 *   Demolished 1936   state of use / "destroyed …" class (+ P576 year)
 *   Until 1675        P576 (dissolved/abolished/demolished date) alone
 *   Former hospital   an instance-of class labelled "former …"
 *
 * No fact, no tag — honest silence, never a bucket guess. The golden
 * sentinel suite in wikidata-test.ts holds this to account.
 */

const Endpoint = 'https://www.wikidata.org/w/api.php';

// The pure classification core moved to @/utils/existence so the tile
// bake (plain node, no path aliases) asks the identical question at
// publish time — re-exported here so the sentinel suite and every
// server caller keep their import path.
export { AreaClassIds, claimIds, claimYear, EventClassIds, existenceTag, isAreaArticle, isEventArticle };
export type { EntityClaims };

async function api(params: Record<string, string>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ action: 'wbgetentities', format: 'json', ...params });
  const response = await fetch(`${Endpoint}?${query}`, {
    headers: { 'User-Agent': UserAgent },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    throw new Error(`Wikidata failed with status ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

const TagTtlMs = 30 * 24 * 60 * 60 * 1000;
// v3: verdicts carry the broad-area flag, so old cached silence cannot
// keep Greenwich/Deptford/Millwall in Nearby for the prior 30-day TTL;
// v2: verdicts carry the event flag (events-are-history ruling) — a v1
// entry lacks it and would keep filing crashes as visitable places
const factCache = diskBackedMap<{ tag: string | null; event: boolean; area: boolean; at: number }>(
  'wikidata-existence-v3',
  // ~86 bytes an entry and one per article ever classified — the
  // cheapest thing here to keep and the fastest to accumulate
  { ttlMs: TagTtlMs, maxEntries: 5000 }
);
// Class labels are stable vocabulary — cached without expiry
// semantics, so only the cap bounds them (oldest-inserted first)
const labelCache = diskBackedMap<string>('wikidata-class-labels', { maxEntries: 2000 });

function chunk<T>(list: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < list.length; start += size) {
    chunks.push(list.slice(start, start + size));
  }
  return chunks;
}

/** Wikidata's claim payload is large: 50 titles regularly crosses the
 * Hosting edge timeout even though a five-title request succeeds. Keep
 * payloads modest and cap concurrency so cold feeds finish without
 * either serial latency or an upstream burst. */
async function inWorkers<T>(
  batches: T[][],
  concurrency: number,
  visit: (batch: T[]) => Promise<void>
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        await visit(batch);
      }
    })
  );
}

/** What Wikidata knows about an article's subject: an existence tag,
 * event verdict, and/or broad geographic-area verdict. Absent field =
 * no evidence. */
export type ExistenceFacts = { tag?: string; event?: true; area?: true };

function toFacts(tag: string | null, event: boolean, area: boolean): ExistenceFacts | null {
  if (!tag && !event && !area) {
    return null;
  }
  return {
    ...(tag ? { tag } : {}),
    ...(event ? { event: true as const } : {}),
    ...(area ? { area: true as const } : {}),
  };
}

/** Existence facts for enwiki article titles, batched and cached —
 * tags, event and area verdicts ride the SAME requests: one host, no second
 * hammer. */
export async function fetchExistenceFacts(titles: string[]): Promise<Map<string, ExistenceFacts>> {
  const facts = new Map<string, ExistenceFacts>();
  const missing: string[] = [];
  for (const title of titles) {
    const cached = factCache.get(title.toLowerCase());
    if (cached && Date.now() - cached.at < TagTtlMs) {
      const fact = toFacts(cached.tag, cached.event, cached.area);
      if (fact) {
        facts.set(title, fact);
      }
    } else {
      missing.push(title);
    }
  }
  if (missing.length === 0) {
    return facts;
  }

  const entityClaims = new Map<string, EntityClaims>();
  await inWorkers(chunk(missing, 15), 3, async (batch) => {
      const body = (await api({
        sites: 'enwiki',
        titles: batch.join('|'),
        props: 'claims|sitelinks',
        sitefilter: 'enwiki',
      })) as {
        entities?: Record<
          string,
          { claims?: EntityClaims; sitelinks?: { enwiki?: { title?: string } } }
        >;
      };
      for (const entity of Object.values(body.entities ?? {})) {
        const title = entity.sitelinks?.enwiki?.title;
        if (title && entity.claims) {
          entityClaims.set(title, entity.claims);
        }
      }
    });

  // Resolve unseen class QIDs to labels, once each, batched
  const classIds = new Set<string>();
  for (const claims of entityClaims.values()) {
    for (const id of [...claimIds(claims, 'P31'), ...claimIds(claims, 'P5816')]) {
      if (!labelCache.get(id)) {
        classIds.add(id);
      }
    }
  }
  for (const batch of chunk([...classIds], 50)) {
    const body = (await api({ ids: batch.join('|'), props: 'labels', languages: 'en' })) as {
      entities?: Record<string, { labels?: { en?: { value?: string } } }>;
    };
    for (const [qid, entity] of Object.entries(body.entities ?? {})) {
      labelCache.set(qid, entity.labels?.en?.value ?? '');
    }
  }
  const labels = new Map<string, string>();
  for (const claims of entityClaims.values()) {
    for (const id of [...claimIds(claims, 'P31'), ...claimIds(claims, 'P5816')]) {
      labels.set(id, labelCache.get(id) ?? '');
    }
  }

  // Titles the batch resolved (case may differ from the request) and
  // titles Wikidata has no item for both get cached verdicts
  const resolved = new Map([...entityClaims.keys()].map((title) => [title.toLowerCase(), title]));
  for (const requested of missing) {
    const actual = resolved.get(requested.toLowerCase());
    const claims = actual ? entityClaims.get(actual)! : null;
    const tag = claims ? existenceTag(claims, labels) : null;
    const event = claims ? isEventArticle(claims) : false;
    const area = claims ? isAreaArticle(claims) : false;
    factCache.set(requested.toLowerCase(), { tag, event, area, at: Date.now() });
    const fact = toFacts(tag, event, area);
    if (fact) {
      facts.set(requested, fact);
    }
  }
  return facts;
}
