import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { ApiError, cachedGet } from '@/data/cached-get';
import { persistedMap } from '@/data/persisted-cache';
import { Article } from '@/types/article';

// Only the COMPLETE article persists (mirroring the server rule below:
// a cached light article would hide the images behind it). Keyed by
// title — content by name, not location-served — with the server's own
// 7d article TTL (src/server/article.ts ArticleTtlMs) mirrored client-side.
//
// Cap: 40 full articles ≈ a week of heavy reading; at ~10-30KB each
// that bounds the store's share of Android AsyncStorage's ~6MB ceiling
// to ~1MB (see persisted-cache's maxEntries).
const ArticleCap = 40;
const articleCache = persistedMap<Article>('article', 7 * 24 * 60 * 60 * 1000, {
  maxEntries: ArticleCap,
});
const metaCache = new Map<string, number>();

export async function fetchArticle(title: string): Promise<Article> {
  let cached = articleCache.get(title);
  if (cached === undefined) {
    await articleCache.hydrated; // a miss may just be pre-hydration
    cached = articleCache.get(title);
  }
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(apiUrl(`/api/article?title=${encodeURIComponent(title)}`));
    if (!response.ok) {
      throw new Error(`Article request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { article: Article };
    articleCache.set(title, body.article);
    return body.article;
  } catch (error) {
    // Offline: a saved article (even past its TTL) beats no article.
    // Failures themselves are never cached.
    const saved = articleCache.peek(title);
    if (saved) {
      return saved.value;
    }
    throw error;
  }
}

/**
 * Chapters-first: the light article paints the hero text and reading
 * time in one cheap server leg, ahead of the ~1.2s of image legs the
 * full article costs cold. Never cached client-side — only the
 * complete article earns a place in articleCache (an empty gallery
 * cached here would hide the images that are seconds behind it).
 */
export async function fetchArticleLight(title: string): Promise<Article> {
  let cached = articleCache.get(title);
  if (cached === undefined) {
    await articleCache.hydrated;
    cached = articleCache.get(title);
  }
  if (cached) {
    return cached; // complete beats light
  }
  const response = await fetch(apiUrl(`/api/article?title=${encodeURIComponent(title)}&light=1`));
  if (!response.ok) {
    // ApiError, not a bare Error: the area-name cascade probes through
    // this leg and must tell a definite 404 from a flaky 5xx
    throw new ApiError('Light article', response.status);
  }
  const body = (await response.json()) as { article: Article };
  return body.article;
}

/** Just the reading time, for the story screen's door. */
export async function fetchArticleMinutes(title: string): Promise<number | null> {
  try {
    return await cachedGet({
      cache: metaCache,
      key: title,
      path: `/api/article?title=${encodeURIComponent(title)}&meta=1`,
      label: 'Article meta',
      unwrap: (body: { minutes: number }) => body.minutes,
    });
  } catch (error) {
    // The deliberate soft policy: a server that can't answer returns
    // null — the door still opens; it just doesn't promise a time.
    // Network failures keep throwing, exactly as before the extraction.
    if (error instanceof ApiError) {
      return null;
    }
    throw error;
  }
}
