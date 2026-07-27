/**
 * Bounded fan-out at keyless upstreams. The standing rule is that
 * Wikipedia, Wikidata and the heritage sources get sequential
 * politeness rather than parallel hammering — a request that opens
 * forty sockets at en.wikipedia.org does not fail alone, it gets the
 * whole worker's egress IP rate-limited, and the NEXT reader's feed
 * is the one that 502s. Measured in production, 27 July: 8 of 12 feed
 * requests failed that way, which the app honestly reported as "you're
 * offline".
 *
 * A pool, not a chunked barrier: work starts as slots free, so one
 * slow lookup never holds back the rest of its batch.
 */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  visit: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await visit(items[index], index);
      }
    })
  );
  return results;
}
