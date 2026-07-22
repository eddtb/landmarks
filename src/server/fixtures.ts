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
  writeFileSync: (path: string, data: string) => void;
  unlinkSync: (path: string) => void;
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
function fixturesDir(): string {
  return process.env.E2E_FIXTURES_DIR ?? 'e2e-fixtures';
}

export function readFixture<T>(name: string): T | null {
  if (!fs) {
    return null;
  }
  const path = `${fixturesDir()}/${name}.json`;
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

/**
 * The E2E outage switch: while the flag file exists, /api/history
 * refuses with a 503 so the offline-stale Maestro flow can drive the
 * "Showing saved stories" path without touching real networking (iOS
 * has no Maestro airplane mode, and in dev topology killing Metro
 * would kill the JS bundle too, not just the API). Toggled over HTTP
 * by /api/e2e-outage — a file, not module state, because Metro
 * bundles each API route separately and module singletons don't
 * cross that boundary. The flag lives in the fixtures dir
 * (gitignored) and is only ever consulted behind fixturesEnabled().
 */
const OutageFlag = 'outage.flag';

export function outageActive(): boolean {
  if (!fs) {
    return false;
  }
  try {
    return fs.existsSync(`${fixturesDir()}/${OutageFlag}`);
  } catch {
    return false;
  }
}

export function setOutage(on: boolean): void {
  if (!fs) {
    return;
  }
  const path = `${fixturesDir()}/${OutageFlag}`;
  try {
    if (on) {
      fs.writeFileSync(path, 'deliberate E2E outage — see .maestro/offline-stale.yaml\n');
    } else if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch (error) {
    console.warn('Outage flag toggle failed:', error);
  }
}
