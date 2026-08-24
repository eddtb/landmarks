import { createTupleScanner, extractColumns, unquote } from '../../scripts/bake/sql-tuples';

// A miniature of the real dump shape: header noise, a CREATE TABLE with
// KEY lines whose backticked names must NOT read as columns, and two
// INSERT statements whose strings carry the traps — escaped quotes,
// commas, and parentheses inside values.
const DumpSample = `-- MySQL dump 10.19
/*!40101 SET @saved_cs_client = @@character_set_client */;
CREATE TABLE \`geo_tags\` (
  \`gt_id\` int(10) unsigned NOT NULL AUTO_INCREMENT,
  \`gt_page_id\` int(10) unsigned NOT NULL,
  \`gt_globe\` varbinary(32) NOT NULL,
  \`gt_primary\` tinyint(1) NOT NULL,
  \`gt_lat\` decimal(11,8) DEFAULT NULL,
  \`gt_lon\` decimal(11,8) DEFAULT NULL,
  PRIMARY KEY (\`gt_id\`),
  KEY \`gt_page_id\` (\`gt_page_id\`,\`gt_primary\`)
) ENGINE=InnoDB AUTO_INCREMENT=99 DEFAULT CHARSET=binary;

INSERT INTO \`geo_tags\` VALUES (1,100,'earth',1,51.48200000,-0.00800000),(2,200,'moon',1,0.10000000,0.20000000);
INSERT INTO \`geo_tags\` VALUES (3,300,'earth',0,53.96000000,-1.08200000),(4,400,'it''s, (earth)\\'ish',1,NULL,NULL);
`;

function scanAll(text: string, chunkSize: number): string[][] {
  const tuples: string[][] = [];
  const scanner = createTupleScanner((values) => tuples.push(values));
  for (let at = 0; at < text.length; at += chunkSize) {
    scanner.push(text.slice(at, at + chunkSize));
  }
  return tuples;
}

describe('extractColumns', () => {
  it('reads column names in order and skips KEY lines', () => {
    expect(extractColumns(DumpSample)).toEqual([
      'gt_id',
      'gt_page_id',
      'gt_globe',
      'gt_primary',
      'gt_lat',
      'gt_lon',
    ]);
  });

  it('returns empty for text with no CREATE TABLE yet', () => {
    expect(extractColumns('-- MySQL dump preamble only')).toEqual([]);
  });
});

describe('createTupleScanner', () => {
  it('emits every tuple across both INSERT statements', () => {
    const tuples = scanAll(DumpSample, DumpSample.length);
    expect(tuples).toHaveLength(4);
    expect(tuples[0]).toEqual(['1', '100', "'earth'", '1', '51.48200000', '-0.00800000']);
    expect(tuples[2][1]).toBe('300');
    expect(tuples[3][4]).toBe('NULL');
  });

  it('keeps commas and parentheses inside strings out of the structure', () => {
    const tuples = scanAll(DumpSample, DumpSample.length);
    // The 4th tuple's globe value contains a comma, parens and an
    // escaped quote — it must arrive as ONE value, not split
    expect(tuples[3]).toHaveLength(6);
    expect(unquote(tuples[3][2])).toBe("it''s, (earth)'ish");
  });

  it('is indifferent to where chunk boundaries fall', () => {
    const whole = scanAll(DumpSample, DumpSample.length);
    for (const chunkSize of [1, 3, 7, 64]) {
      expect(scanAll(DumpSample, chunkSize)).toEqual(whole);
    }
  });

  it('does not treat backticked names in the DDL as tuples', () => {
    const tuples = scanAll(DumpSample, 16);
    // KEY (`gt_page_id`,`gt_primary`) is parenthesised but sits before
    // any VALUES keyword — nothing may come out of it
    expect(tuples.every((values) => values.length === 6)).toBe(true);
  });
});

describe('unquote', () => {
  it('passes numbers and NULL through', () => {
    expect(unquote('51.482')).toBe('51.482');
    expect(unquote('NULL')).toBe('NULL');
  });

  it('strips quotes and backslash escapes', () => {
    expect(unquote("'earth'")).toBe('earth');
    expect(unquote("'St Paul\\'s'")).toBe("St Paul's");
    expect(unquote("'line\\nbreak'")).toBe('line\nbreak');
  });
});
