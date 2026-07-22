/**
 * The article shape, defined once for both sides of the wire:
 * src/server/article.ts composes it, src/data/article-client.ts
 * consumes it. One truth per shape (like HistoryItem in history.ts) —
 * a field added on one side can no longer silently miss the other.
 */

export type ArticleChapter = { title: string; paragraphs: string[] };

export type ArticleImage = { imageUrl: string; credit: string };

export type Article = { chapters: ArticleChapter[]; minutes: number; images: ArticleImage[] };
