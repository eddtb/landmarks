import { fixturesEnabled, readFixture } from '@/server/fixtures';
import { fetchStoryByPageId } from '@/server/wikipedia';
import { HistoryItem, isWikiPageId } from '@/types/history';

/**
 * GET /api/story?pageId=40729675
 *
 * One story by Wikipedia pageId — the cold-start half of share
 * deep-links: a recipient opening landmarks://history/<pageId> has an
 * empty session cache, so the detail screen asks for exactly this
 * story. Synthetic heritage ids (listed buildings 2e9+, plaques 3e9+ —
 * see heritage.ts) have no Wikipedia page to resolve and 404; plaque
 * shares keep their openplaques URL instead. Wikipedia is keyless and
 * unmetered — no budget table entry.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const pageIdParam = url.searchParams.get('pageId');
  const pageId = pageIdParam ? Number(pageIdParam) : NaN;
  if (!Number.isInteger(pageId) || pageId <= 0) {
    return Response.json({ error: 'Expected a numeric pageId' }, { status: 400 });
  }

  // Hermetic E2E: a dedicated story fixture wins, else the recorded
  // history feed serves the item — never a live upstream in CI
  if (fixturesEnabled()) {
    const single = readFixture<{ item: HistoryItem }>(`story-${pageId}`);
    if (single) {
      return Response.json(single);
    }
    const history = readFixture<{ items: HistoryItem[] }>('history');
    const item = history?.items.find((candidate) => candidate.pageId === pageId);
    return item
      ? Response.json({ item })
      : Response.json({ error: 'No story' }, { status: 404 });
  }

  if (!isWikiPageId(pageId)) {
    return Response.json({ error: 'No story' }, { status: 404 });
  }

  try {
    const item = await fetchStoryByPageId(pageId);
    if (!item) {
      return Response.json({ error: 'No story' }, { status: 404 });
    }
    return Response.json({ item });
  } catch (error) {
    console.error('Story fetch failed:', error);
    return Response.json({ error: 'Story fetch failed' }, { status: 502 });
  }
}
