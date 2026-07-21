import { EntityClaims, existenceTag } from '@/server/wikidata';

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
