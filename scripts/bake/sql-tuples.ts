/**
 * Streaming parser for mysqldump INSERT tuples — the shape Wikimedia's
 * table dumps (enwiki-latest-geo_tags.sql.gz) arrive in. Pure and
 * import-free so the jest suite can fixture-test it; the bake entry
 * point (parse-geo-tags.ts) feeds it gunzipped chunks.
 *
 * The scanner ignores everything until the keyword VALUES, then emits
 * each parenthesised tuple as an array of raw value strings ('quoted'
 * text kept quoted — see unquote), until the statement's closing ';'
 * sends it back to looking for the next VALUES. State survives across
 * push() calls, so chunk boundaries may fall anywhere — mid-string,
 * mid-number, mid-keyword.
 */

export type TupleScanner = {
  push(text: string): void;
};

export function createTupleScanner(onTuple: (values: string[]) => void): TupleScanner {
  type Mode = 'seek' | 'between' | 'value' | 'string' | 'stringEscape';
  let mode: Mode = 'seek';
  let seekTail = ''; // last chars seen, to spot VALUES across a chunk boundary
  let value = '';
  let values: string[] = [];

  return {
    push(text: string) {
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        switch (mode) {
          case 'seek':
            seekTail = (seekTail + ch).slice(-7);
            if (seekTail.endsWith('VALUES')) {
              mode = 'between';
            }
            break;
          case 'between':
            if (ch === '(') {
              mode = 'value';
              value = '';
              values = [];
            } else if (ch === ';') {
              seekTail = '';
              mode = 'seek';
            }
            // commas, whitespace and newlines between tuples: skip
            break;
          case 'value':
            if (ch === "'") {
              value += ch;
              mode = 'string';
            } else if (ch === ',') {
              values.push(value);
              value = '';
            } else if (ch === ')') {
              values.push(value);
              onTuple(values);
              mode = 'between';
            } else {
              value += ch;
            }
            break;
          case 'string':
            value += ch;
            if (ch === '\\') {
              mode = 'stringEscape';
            } else if (ch === "'") {
              mode = 'value';
            }
            break;
          case 'stringEscape':
            value += ch;
            mode = 'string';
            break;
        }
      }
    },
  };
}

/** 'earth' → earth; numbers and NULL pass through untouched. */
export function unquote(raw: string): string {
  if (!raw.startsWith("'")) {
    return raw;
  }
  return raw
    .slice(1, -1)
    .replace(/\\(.)/g, (_match, escaped: string) =>
      escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped
    );
}

/**
 * Column names, in order, from the dump's CREATE TABLE statement —
 * read rather than assumed, because the geo_tags schema has dropped
 * columns before (gt_name, gt_country et al) and a hard-coded index
 * would silently read longitude out of the wrong slot.
 */
export function extractColumns(headerText: string): string[] {
  const table = headerText.match(/CREATE TABLE `\w+` \(([\s\S]*?)\)\s*ENGINE/);
  if (!table) {
    return [];
  }
  const columns: string[] = [];
  for (const line of table[1].split('\n')) {
    const definition = line.trim();
    if (definition.startsWith('`')) {
      const name = definition.match(/^`(\w+)`/);
      if (name) {
        columns.push(name[1]);
      }
    }
  }
  return columns;
}
