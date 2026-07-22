import { EntityClaims, existenceTag, isEventArticle } from '@/server/wikidata';

/**
 * THE GOLDEN SENTINEL SUITE. Every shape below is a real place whose
 * claims were recorded from live Wikidata (2026-07-22) after the
 * grammar classifiers (#135, #137) repeatedly misfiled real things.
 * Any change to existence classification must keep every sentinel
 * true — these are the places that were wrong on Edd's phone.
 */

const labels = new Map([
  ['Q19860854', 'destroyed building or structure'],
  ['Q56556915', 'demolished or destroyed'],
  ['Q64578911', 'former hospital'],
  ['Q35112127', 'historic building'],
  ['Q23413', 'castle'],
  ['Q16970', 'church building'],
  ['Q179700', 'statue'],
  ['Q273081', 'clipper'],
]);

const claims = (spec: { p576?: string; p31?: string[]; p5816?: string[] }): EntityClaims => ({
  ...(spec.p576
    ? { P576: [{ mainsnak: { datavalue: { value: { time: `+${spec.p576}-00-00T00:00:00Z` } } } }] }
    : {}),
  P31: (spec.p31 ?? []).map((id) => ({ mainsnak: { datavalue: { value: { id } } } })),
  P5816: (spec.p5816 ?? []).map((id) => ({ mainsnak: { datavalue: { value: { id } } } })),
});

describe('existenceTag — the golden sentinels', () => {
  test('Palace of Placentia: destroyed-building class + date → Demolished, with year', () => {
    expect(existenceTag(claims({ p576: '1694', p31: ['Q19860854'] }), labels)).toBe(
      'Demolished 1694'
    );
  });

  test("St Mary's Church: state of use 'demolished or destroyed', no date → Demolished", () => {
    expect(existenceTag(claims({ p31: ['Q16970'], p5816: ['Q56556915'] }), labels)).toBe(
      'Demolished'
    );
  });

  test("Greenwich Hospital: 'former hospital' class, buildings still standing → the class IS the tag", () => {
    expect(existenceTag(claims({ p31: ['Q64578911', 'Q35112127'] }), labels)).toBe(
      'Former hospital'
    );
  });

  test('Greenwich Castle: bare cessation date → Until 1675, no physical claim', () => {
    expect(existenceTag(claims({ p576: '1675', p31: ['Q23413'] }), labels)).toBe('Until 1675');
  });

  test('the standing things carry NOTHING — statue, ship, historic building', () => {
    expect(existenceTag(claims({ p31: ['Q179700'] }), labels)).toBeNull(); // Statue of Walter Raleigh
    expect(existenceTag(claims({ p31: ['Q273081'] }), labels)).toBeNull(); // Cutty Sark
    expect(existenceTag(claims({ p31: ['Q35112127'] }), labels)).toBeNull(); // ORNC-ish
  });

  test('no claims at all is honest silence, not a guess', () => {
    expect(existenceTag({}, labels)).toBeNull(); // Millwall Iron Works had nothing
  });

  test('unknown class labels never classify', () => {
    expect(existenceTag(claims({ p31: ['Q999999'] }), new Map())).toBeNull();
  });
});

/**
 * The event sentinels (events-are-history ruling): P31 shapes recorded
 * from live Wikidata (2026-07-22). Articles ABOUT events route to the
 * archive; places that HOSTED events never do.
 */
describe('isEventArticle — events belong to the archive, not Nearby', () => {
  test('Lewisham rail crash: train wreck / SPAD / rear-end collision → event', () => {
    // Q1312322's actual P31 values
    expect(isEventArticle(claims({ p31: ['Q1078765', 'Q2811650', 'Q375102'] }))).toBe(true);
  });

  test('1898 St Johns rail accident: bare train wreck → event', () => {
    expect(isEventArticle(claims({ p31: ['Q1078765'] }))).toBe(true);
  });

  test('the places that HOSTED events carry place classes — never routed', () => {
    // St Johns railway station: railway station
    expect(isEventArticle(claims({ p31: ['Q55488'] }))).toBe(false);
    // Lewisham station: DLR station, Keilbahnhof, terminus, station in a cut
    expect(
      isEventArticle(claims({ p31: ['Q18516630', 'Q55677', 'Q20202072', 'Q98280550'] }))
    ).toBe(false);
    // A statue, a clipper, a historic building (the standing sentinels)
    expect(isEventArticle(claims({ p31: ['Q179700', 'Q273081', 'Q35112127'] }))).toBe(false);
  });

  test('battles and disasters from the probes: battle, maritime disaster, aviation accident', () => {
    expect(isEventArticle(claims({ p31: ['Q178561'] }))).toBe(true); // Battle of Lewisham
    expect(isEventArticle(claims({ p31: ['Q2192508', 'Q2620513'] }))).toBe(true); // Marchioness
    expect(isEventArticle(claims({ p31: ['Q744913'] }))).toBe(true); // 1958 Dove crash
  });

  test('precision over recall: an unknown or event-ish-but-uncurated class never routes', () => {
    expect(isEventArticle(claims({ p31: ['Q26132862'] }))).toBe(false); // Olympic sports discipline event
    expect(isEventArticle(claims({}))).toBe(false);
  });
});
