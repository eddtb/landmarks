import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';

export type ArticleChapter = { title: string; paragraphs: string[] };
export type ArticleImage = { imageUrl: string; credit: string };
export type Article = { chapters: ArticleChapter[]; minutes: number; images: ArticleImage[] };

const articleCache = new Map<string, Article>();
const metaCache = new Map<string, number>();

export async function fetchArticle(title: string): Promise<Article> {
  const cached = articleCache.get(title);
  if (cached) {
    return cached;
  }
  const response = await fetch(apiUrl(`/api/article?title=${encodeURIComponent(title)}`));
  if (!response.ok) {
    throw new Error(`Article request failed with status ${response.status}`);
  }
  const body = (await response.json()) as { article: Article };
  articleCache.set(title, body.article);
  return body.article;
}

/**
 * Chapters-first: the light article paints the hero text and reading
 * time in one cheap server leg, ahead of the ~1.2s of image legs the
 * full article costs cold. Never cached client-side — only the
 * complete article earns a place in articleCache (an empty gallery
 * cached here would hide the images that are seconds behind it).
 */
export async function fetchArticleLight(title: string): Promise<Article> {
  const cached = articleCache.get(title);
  if (cached) {
    return cached; // complete beats light
  }
  const response = await fetch(apiUrl(`/api/article?title=${encodeURIComponent(title)}&light=1`));
  if (!response.ok) {
    throw new Error(`Light article request failed with status ${response.status}`);
  }
  const body = (await response.json()) as { article: Article };
  return body.article;
}

/** Just the reading time, for the story screen's door. */
export async function fetchArticleMinutes(title: string): Promise<number | null> {
  const cached = metaCache.get(title);
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(apiUrl(`/api/article?title=${encodeURIComponent(title)}&meta=1`));
  if (!response.ok) {
    return null; // the door still opens; it just doesn't promise a time
  }
  const body = (await response.json()) as { minutes: number };
  metaCache.set(title, body.minutes);
  return body.minutes;
}
