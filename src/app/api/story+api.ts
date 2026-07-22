import { diskBackedMap } from '@/server/ai-cache';
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

// 7 days: the payload is Wikipedia page metadata (title, intro
// extract, thumbnail, url, coordinates) — the same HistoryItem the
// client already persists for 7 days (history-client.ts itemCache), so
// the server holding it any shorter just re-asks Wikipedia for data
// every device is happy to keep a week, and any longer would outlive
// the client's own trust in it.
const StoryTtlMs = 7 * 24 * 60 * 60 * 1000;
// Only real items are ever stored — a 404 (missing page, synthetic
// id) or an upstream failure is a moment's verdict, not a fact about
// the page, and must never be replayed for a week.
const storyCache = diskBackedMap<{ item: HistoryItem; at: number }>('stories-v1');

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

  const cached = storyCache.get(String(pageId));
  if (cached && Date.now() - cached.at < StoryTtlMs) {
    return Response.json({ item: cached.item });
  }

  try {
    const item = await fetchStoryByPageId(pageId);
    if (!item) {
      return Response.json({ error: 'No story' }, { status: 404 });
    }
    storyCache.set(String(pageId), { item, at: Date.now() });
    return Response.json({ item });
  } catch (error) {
    console.error('Story fetch failed:', error);
    return Response.json({ error: 'Story fetch failed' }, { status: 502 });
  }
}
