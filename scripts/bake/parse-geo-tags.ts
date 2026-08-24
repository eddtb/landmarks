/**
 * Bake stage 1: the enwiki geo_tags dump → every UK-coordinate page.
 *
 *   node scripts/bake/parse-geo-tags.ts [dump.sql.gz] [out.ndjson]
 *
 * Downloads the ~53 MB dump on first run (kept in .bake/, gitignored),
 * streams it through gunzip and the tuple scanner, and writes one
 * NDJSON line per page: {"p":pageId,"lat":…,"lng":…}. Keeps only
 * gt_globe='earth', gt_primary=1, and coordinates inside the UK box —
 * the same box the sizing probes used. Namespace filtering happens in
 * stage 2: geo_tags carries no namespace, but the extract sweep's API
 * responses do, so non-articles fall out there.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { createTupleScanner, extractColumns, unquote } from './sql-tuples.ts';

const DumpUrl = 'https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-geo_tags.sql.gz';
const UkBox = { south: 49.85, west: -8.65, north: 60.9, east: 1.77 };

const dumpPath = process.argv[2] ?? '.bake/enwiki-latest-geo_tags.sql.gz';
const outPath = process.argv[3] ?? '.bake/uk-pages.ndjson';

async function download(): Promise<void> {
  console.log(`[bake] downloading ${DumpUrl}`);
  const response = await fetch(DumpUrl);
  if (!response.ok || !response.body) {
    throw new Error(`dump download failed with status ${response.status}`);
  }
  fs.mkdirSync('.bake', { recursive: true });
  await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(`${dumpPath}.part`));
  fs.renameSync(`${dumpPath}.part`, dumpPath);
  console.log(`[bake] saved ${(fs.statSync(dumpPath).size / 1e6).toFixed(0)} MB to ${dumpPath}`);
}

async function main(): Promise<void> {
  if (!fs.existsSync(dumpPath)) {
    await download();
  }
  fs.mkdirSync('.bake', { recursive: true });
  const out = fs.createWriteStream(`${outPath}.part`);

  let header = '';
  let columns: string[] = [];
  let latAt = -1;
  let lngAt = -1;
  let pageAt = -1;
  let globeAt = -1;
  let primaryAt = -1;

  let tuples = 0;
  let kept = 0;
  const seen = new Set<number>();

  const scanner = createTupleScanner((values) => {
    tuples++;
    if (unquote(values[globeAt]) !== 'earth' || values[primaryAt] !== '1') {
      return;
    }
    const lat = Number(values[latAt]);
    const lng = Number(values[lngAt]);
    const pageId = Number(values[pageAt]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isInteger(pageId)) {
      return;
    }
    if (lat < UkBox.south || lat > UkBox.north || lng < UkBox.west || lng > UkBox.east) {
      return;
    }
    if (seen.has(pageId)) {
      return; // one primary coordinate per page is the contract; trust the first
    }
    seen.add(pageId);
    kept++;
    out.write(`${JSON.stringify({ p: pageId, lat, lng })}\n`);
  });

  const decoder = new TextDecoder();
  const gunzip = zlib.createGunzip();
  gunzip.on('data', (chunk: Buffer) => {
    const text = decoder.decode(chunk, { stream: true });
    if (columns.length === 0) {
      header += text;
      columns = extractColumns(header);
      if (columns.length > 0) {
        pageAt = columns.indexOf('gt_page_id');
        globeAt = columns.indexOf('gt_globe');
        primaryAt = columns.indexOf('gt_primary');
        latAt = columns.indexOf('gt_lat');
        lngAt = columns.indexOf('gt_lon');
        if ([pageAt, globeAt, primaryAt, latAt, lngAt].includes(-1)) {
          throw new Error(`geo_tags schema changed — columns now: ${columns.join(', ')}`);
        }
        console.log(`[bake] columns: ${columns.join(', ')}`);
        header = ''; // stop accumulating; the scanner sees every chunk anyway
      }
    }
    scanner.push(text);
  });

  await pipeline(fs.createReadStream(dumpPath), gunzip);
  await new Promise((resolve) => out.end(resolve));
  fs.renameSync(`${outPath}.part`, outPath);
  console.log(`[bake] ${tuples} coordinates → ${kept} UK pages → ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
