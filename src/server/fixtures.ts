/**
 * Hermetic fixtures for E2E CI. GitHub's shared runner IPs get
 * rate-limited by Wikipedia/Wikidata (run 6: batch query 429 →
 * history 502 → no cards → red), so under E2E_FIXTURES=1 the API
 * routes serve recorded payloads from e2e-fixtures/ instead of
 * calling live upstreams. The flag off (default) leaves every route
 * byte-identical to today — this module is only a read gate.
 *
 * Fixtures are deliberate, committed test data pinned to Greenwich
 * (CI pins the simulator there) — NOT .ai-cache, which stays
 * gitignored. Re-recording recipe lives in e2e-fixtures/README.md.
 */

type FsModule = {
  readFileSync: (path: string, encoding: 'utf8') => string;
  existsSync: (path: string) => boolean;
};

// Same guarded require as ai-cache.ts: on runtimes without a
// filesystem this degrades to "no fixtures", never to a crash
let fs: FsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  fs = require('fs') as FsModule;
} catch {
  fs = null;
}

export function fixturesEnabled(): boolean {
  return process.env.E2E_FIXTURES === '1';
}

/**
 * The recorded payload for <name>, or null when absent/unreadable —
 * callers keep their existing "missing" behaviour (404s stay 404s).
 * Tests point E2E_FIXTURES_DIR at a temp dir; CI uses the default.
 */
export function readFixture<T>(name: string): T | null {
  if (!fs) {
    return null;
  }
  const dir = process.env.E2E_FIXTURES_DIR ?? 'e2e-fixtures';
  const path = `${dir}/${name}.json`;
  try {
    if (!fs.existsSync(path)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(path, 'utf8')) as T;
  } catch (error) {
    console.warn(`Fixture read failed (${name}):`, error);
    return null;
  }
}

/**
 * Fixture-file slug for an article/retold title: lowercase, spaces to
 * dashes, everything else non-alphanumeric stripped.
 * 'Royal Observatory, Greenwich' → 'royal-observatory-greenwich'.
 */
export function fixtureSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}
