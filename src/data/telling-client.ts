import { cachedGet } from '@/data/cached-get';
import { storyParagraphs } from '@/utils/format';

/** Anything with a story to tell: HistoryItem and WalkStop both fit. */
export type TellingSource = {
  pageId: number;
  title: string;
  extract?: string;
  source: string;
};

// Session cache: the server's disk cache makes re-fetches cheap, but
// not free-feeling — a second Listen must start instantly.
const cache = new Map<number, string>();

export async function fetchTelling(item: TellingSource): Promise<string> {
  return cachedGet({
    cache,
    key: item.pageId,
    path: '/api/telling',
    label: 'Telling',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageId: item.pageId,
        title: item.title,
        // IPA parentheticals are worst read aloud — clean before the writer sees them
        extract: storyParagraphs(item.extract ?? '').join('\n'),
        source: item.source,
      }),
    },
    unwrap: (body: { telling: string }) => body.telling,
  });
}
