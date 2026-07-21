import { diskBackedMap } from '@/server/ai-cache';

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
const UserAgent = 'landmarks-app/1.0 (https://github.com/eddtb/landmarks; learning project)';

type Snak = { mainsnak: { datavalue?: { value?: { id?: string; time?: string } } } };
export type EntityClaims = Record<string, Snak[]>;

function claimIds(claims: EntityClaims, property: string): string[] {
  return (claims[property] ?? []).flatMap((snak) => {
    const id = snak.mainsnak.datavalue?.value?.id;
    return id ? [id] : [];
  });
}

function claimYear(claims: EntityClaims, property: string): string | null {
  for (const snak of claims[property] ?? []) {
    const time = snak.mainsnak.datavalue?.value?.time;
    if (time) {
      return time.slice(1, 5); // "+1675-00-00T…" → "1675"
    }
  }
  return null;
}

/**
 * Pure and sentinel-tested: claims + class labels → the tag, or null.
 */
export function existenceTag(
  claims: EntityClaims,
  classLabels: Map<string, string>
): string | null {
  const year = claimYear(claims, 'P576');
  const classes = [...claimIds(claims, 'P31'), ...claimIds(claims, 'P5816')].map(
    (id) => classLabels.get(id) ?? ''
  );

  if (classes.some((label) => /^(destroyed|demolished)/i.test(label))) {
    return year ? `Demolished ${year}` : 'Demolished';
  }
  const former = classes.find((label) => /^former /i.test(label));
  if (former) {
    return former.charAt(0).toUpperCase() + former.slice(1);
  }
  if (year) {
    return `Until ${year}`;
  }
  return null;
}

async function api(params: Record<string, string>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ action: 'wbgetentities', format: 'json', ...params });
  const response = await fetch(`${Endpoint}?${query}`, {
    headers: { 'User-Agent': UserAgent },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) {
    throw new Error(`Wikidata failed with status ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

const TagTtlMs = 30 * 24 * 60 * 60 * 1000;
const tagCache = diskBackedMap<{ tag: string | null; at: number }>('wikidata-existence');
// Class labels are stable vocabulary — cache without expiry semantics
const labelCache = diskBackedMap<string>('wikidata-class-labels');

function chunk<T>(list: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < list.length; start += size) {
    chunks.push(list.slice(start, start + size));
  }
  return chunks;
}

/** Existence tags for enwiki article titles, batched and cached. */
export async function fetchExistenceTags(titles: string[]): Promise<Map<string, string>> {
  const tags = new Map<string, string>();
  const missing: string[] = [];
  for (const title of titles) {
    const cached = tagCache.get(title.toLowerCase());
    if (cached && Date.now() - cached.at < TagTtlMs) {
      if (cached.tag) {
        tags.set(title, cached.tag);
      }
    } else {
      missing.push(title);
    }
  }
  if (missing.length === 0) {
    return tags;
  }

  const entityClaims = new Map<string, EntityClaims>();
  for (const batch of chunk(missing, 50)) {
    const body = (await api({
      sites: 'enwiki',
      titles: batch.join('|'),
      props: 'claims|sitelinks',
    })) as {
      entities?: Record<string, { claims?: EntityClaims; sitelinks?: { enwiki?: { title?: string } } }>;
    };
    for (const entity of Object.values(body.entities ?? {})) {
      const title = entity.sitelinks?.enwiki?.title;
      if (title && entity.claims) {
        entityClaims.set(title, entity.claims);
      }
    }
  }

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
    const tag = actual ? existenceTag(entityClaims.get(actual)!, labels) : null;
    tagCache.set(requested.toLowerCase(), { tag, at: Date.now() });
    if (tag) {
      tags.set(requested, tag);
    }
  }
  return tags;
}
