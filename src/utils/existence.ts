/**
 * The pure core of Wikidata existence classification: claims in, a
 * verdict out. The grammar experiments (#135, #137) proved past-tense
 * prose cannot tell a demolished palace from a dissolved institution in
 * a standing building — Wikidata can, and every claim carries its own
 * evidence:
 *
 *   Demolished 1936   state of use / "destroyed …" class (+ P576 year)
 *   Until 1675        P576 (dissolved/abolished/demolished date) alone
 *   Former hospital   an instance-of class labelled "former …"
 *
 * No fact, no tag — honest silence, never a bucket guess. The golden
 * sentinel suite in src/server/__tests__/wikidata-test.ts holds this to
 * account (through src/server/wikidata.ts's re-exports).
 *
 * Lives here, import-free, for the same reason as story-title.ts: the
 * tile bake (plain `node`, no path aliases) must ask the identical
 * question at publish time that the live compose asks at request time.
 */

type Snak = { mainsnak: { datavalue?: { value?: { id?: string; time?: string } } } };
export type EntityClaims = Record<string, Snak[]>;

export function claimIds(claims: EntityClaims, property: string): string[] {
  return (claims[property] ?? []).flatMap((snak) => {
    const id = snak.mainsnak.datavalue?.value?.id;
    return id ? [id] : [];
  });
}

export function claimYear(claims: EntityClaims, property: string): string | null {
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
export const EventClassIds = new Set([
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

/** Geographic subjects whose coordinates are representative centres,
 * not visitable destinations. Precision wins: these are exact P31
 * classes observed on Greenwich, Deptford and Millwall. A building in
 * one of those places carries building/museum/observatory classes and
 * therefore cannot match this gate. */
export const AreaClassIds = new Set([
  'Q149621', // district (Greenwich)
  'Q3957', // town (Greenwich)
  'Q2755753', // area of London (Greenwich, Deptford, Millwall)
]);

/**
 * Pure and sentinel-tested: is this article ABOUT an event? Membership
 * is by QID, not label — no extra lookups, no fuzzy matching.
 */
export function isEventArticle(claims: EntityClaims): boolean {
  return claimIds(claims, 'P31').some((id) => EventClassIds.has(id));
}

export function isAreaArticle(claims: EntityClaims): boolean {
  return claimIds(claims, 'P31').some((id) => AreaClassIds.has(id));
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
