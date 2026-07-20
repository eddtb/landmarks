import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';

export type ArticleChapter = { title: string; paragraphs: string[] };
export type Article = { chapters: ArticleChapter[]; minutes: number };

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
