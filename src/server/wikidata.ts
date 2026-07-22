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
 * P31 classes whose instances are unambiguously EVENTS — articles
 * ABOUT a happening, never places that hosted one (a station, a field,
 * a burnt building carries building/place classes, not these). Curated
 * precision-over-recall from live Wikidata probes (2026-07-22): every
 * QID below was observed as the actual P31 of a real event article
 * (named in each comment). Edd's ruling: these belong in the History
 * archive, not the Nearby feed — no P31 match, no routing.
 */
const EventClassIds = new Set([
  // Transport accidents
  'Q1078765', // train wreck (Lewisham rail crash, 1898 St Johns rail accident, Moorgate tube crash)
  'Q375102', // rear-end collision (Lewisham rail crash)
  'Q2811650', // signal passed at danger (Lewisham rail crash)
  'Q744913', // aviation accident (1958 Channel Airways DH.104 Dove crash, BEA Flight 548)
  'Q2192508', // ship collision (Marchioness disaster)
  'Q906512', // shipwrecking (Sinking of SS Princess Alice)
  // Disasters
  'Q171558', // accident (Silvertown explosion)
  'Q179057', // explosion (Silvertown explosion)
  'Q3839081', // disaster (Grenfell Tower fire)
  'Q7538017', // skyscraper fire (Grenfell Tower fire)
  'Q838718', // city fire (Great Fire of London)
  'Q2620513', // maritime disaster (Marchioness disaster)
  // Battles and sieges
  'Q178561', // battle (Battle of Lewisham)
  'Q188055', // siege (Siege of Sidney Street)
  'Q3199915', // massacre (Peterloo Massacre)
  // Crimes and attacks
  'Q217327', // suicide attack (7 July 2005 London bombings)
  'Q6813020', // stabbing attack (2017 Westminster attack)
  'Q18711682', // vehicle-ramming attack (2017 Westminster attack)
  'Q16738832', // criminal case (Murder of Stephen Lawrence)
  'Q124757', // riot (1981 Brixton riot)
  'Q3588250', // ethnic riot (2011 England riots)
]);

/**
 * Pure and sentinel-tested: is this article ABOUT an event? Membership
 * is by QID, not label — no extra lookups, no fuzzy matching.
 */
export function isEventArticle(claims: EntityClaims): boolean {
  return claimIds(claims, 'P31').some((id) => EventClassIds.has(id));
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
// v2: verdicts carry the event flag (events-are-history ruling) — a v1
// entry lacks it and would keep filing crashes as visitable places
const factCache = diskBackedMap<{ tag: string | null; event: boolean; at: number }>(
  'wikidata-existence-v2'
);
// Class labels are stable vocabulary — cache without expiry semantics
const labelCache = diskBackedMap<string>('wikidata-class-labels');

function chunk<T>(list: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < list.length; start += size) {
    chunks.push(list.slice(start, start + size));
  }
  return chunks;
}

/** What Wikidata knows about an article's subject: an existence tag
 * ("Demolished 1936"), an event verdict (the article is ABOUT a crash,
 * a battle, a fire), or both. Absent field = no evidence. */
export type ExistenceFacts = { tag?: string; event?: true };

function toFacts(tag: string | null, event: boolean): ExistenceFacts | null {
  if (!tag && !event) {
    return null;
  }
  return { ...(tag ? { tag } : {}), ...(event ? { event: true as const } : {}) };
}

/** Existence facts for enwiki article titles, batched and cached —
 * tags and event verdicts ride the SAME requests: one host, no second
 * hammer. */
export async function fetchExistenceFacts(titles: string[]): Promise<Map<string, ExistenceFacts>> {
  const facts = new Map<string, ExistenceFacts>();
  const missing: string[] = [];
  for (const title of titles) {
    const cached = factCache.get(title.toLowerCase());
    if (cached && Date.now() - cached.at < TagTtlMs) {
      const fact = toFacts(cached.tag, cached.event);
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
    const claims = actual ? entityClaims.get(actual)! : null;
    const tag = claims ? existenceTag(claims, labels) : null;
    const event = claims ? isEventArticle(claims) : false;
    factCache.set(requested.toLowerCase(), { tag, event, at: Date.now() });
    const fact = toFacts(tag, event);
    if (fact) {
      facts.set(requested, fact);
    }
  }
  return facts;
}
