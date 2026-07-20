import { getArticle } from '@/server/article';

/**
 * GET /api/article?title=Cutty%20Sark[&meta=1]
 *
 * The full story, parsed into chapters. meta=1 returns just the
 * reading time — the story screen's door shows it without hauling
 * the whole article across (and the fetch warms the server cache
 * for the reader push that usually follows).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const title = url.searchParams.get('title');
  if (!title) {
    return Response.json({ error: 'Expected title' }, { status: 400 });
  }

  try {
    const article = await getArticle(title);
    if (!article || article.chapters.length === 0) {
      return Response.json({ error: 'No article' }, { status: 404 });
    }
    if (url.searchParams.get('meta') === '1') {
      return Response.json({ minutes: article.minutes, chapters: article.chapters.length });
    }
    return Response.json({ article });
  } catch (error) {
    console.error('Article fetch failed:', error);
    return Response.json({ error: 'Article fetch failed' }, { status: 502 });
  }
}
