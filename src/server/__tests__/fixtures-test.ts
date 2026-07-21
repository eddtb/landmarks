import { fixtureSlug, fixturesEnabled, readFixture } from '@/server/fixtures';

// Same guarded require the module itself uses — the app tsconfig has
// no node types, and this test only runs under node
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mkdtempSync, writeFileSync, rmSync } = require('fs') as {
  mkdtempSync: (prefix: string) => string;
  writeFileSync: (path: string, data: string) => void;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { tmpdir } = require('os') as { tmpdir: () => string };

/**
 * The hermetic-CI switch: flag off must leave the live routes
 * untouched, flag on must serve exactly what was recorded, and a
 * missing fixture must read as null so routes keep their 404s.
 */
describe('E2E fixtures helper', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(`${tmpdir()}/e2e-fixtures-test-`);
    // Tests point the reader at a temp dir — never the committed
    // Greenwich fixtures (E2E_FIXTURES_DIR, like AI_CACHE_DIR)
    process.env.E2E_FIXTURES_DIR = dir;
    writeFileSync(`${dir}/history.json`, JSON.stringify({ items: [{ title: 'Cutty Sark' }] }));
  });

  afterAll(() => {
    delete process.env.E2E_FIXTURES;
    delete process.env.E2E_FIXTURES_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  test('flag off (default) — fixtures are inert', () => {
    delete process.env.E2E_FIXTURES;
    expect(fixturesEnabled()).toBe(false);
  });

  test('flag must be exactly "1"', () => {
    process.env.E2E_FIXTURES = 'true';
    expect(fixturesEnabled()).toBe(false);
    process.env.E2E_FIXTURES = '1';
    expect(fixturesEnabled()).toBe(true);
  });

  test('flag on + file present — the recorded payload, parsed', () => {
    process.env.E2E_FIXTURES = '1';
    expect(readFixture<{ items: { title: string }[] }>('history')).toEqual({
      items: [{ title: 'Cutty Sark' }],
    });
  });

  test('missing file — null, so routes keep their live 404 shape', () => {
    expect(readFixture('article-no-such-place')).toBeNull();
  });

  test('unparseable file — null, never a throw', () => {
    writeFileSync(`${dir}/broken.json`, '{not json');
    expect(readFixture('broken')).toBeNull();
  });
});

describe('fixtureSlug', () => {
  test('lowercases, dashes spaces, strips the rest', () => {
    expect(fixtureSlug('Cutty Sark')).toBe('cutty-sark');
    expect(fixtureSlug('Royal Observatory, Greenwich')).toBe('royal-observatory-greenwich');
    expect(fixtureSlug("St Alfege's Church")).toBe('st-alfeges-church');
  });
});
