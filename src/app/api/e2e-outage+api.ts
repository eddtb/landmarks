import { fixturesEnabled, setOutage } from '@/server/fixtures';

/**
 * GET /api/e2e-outage?on=1|0 — the E2E control tap for the
 * offline-stale flow. Maestro's runScript http.get flips it on, the
 * app's next /api/history fetch gets a deliberate 503, and the
 * client's saved-stories fallback (with its "you're offline" banner)
 * gets exercised hermetically. The flag is a file in the fixtures dir
 * (see fixtures.ts for why not module state).
 *
 * Inert outside E2E: without E2E_FIXTURES=1 this route answers 404
 * and writes nothing — a production or plain-dev server keeps its
 * exact pre-existing surface. No AI, no upstream, no budget entry.
 */
export function GET(request: Request) {
  if (!fixturesEnabled()) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const on = new URL(request.url).searchParams.get('on') === '1';
  setOutage(on);
  return Response.json({ outage: on });
}
