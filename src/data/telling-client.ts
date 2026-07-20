import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { HistoryItem } from '@/types/history';

// Session cache: the server's disk cache makes re-fetches cheap, but
// not free-feeling — a second Listen must start instantly.
const cache = new Map<number, string>();

export async function fetchTelling(item: HistoryItem): Promise<string> {
  const cached = cache.get(item.pageId);
  if (cached) {
    return cached;
  }

  const response = await fetch(apiUrl('/api/telling'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pageId: item.pageId,
      title: item.title,
      extract: item.extract ?? '',
      source: item.source,
    }),
  });
  if (!response.ok) {
    throw new Error(`Telling request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { telling: string };
  cache.set(item.pageId, body.telling);
  return body.telling;
}
