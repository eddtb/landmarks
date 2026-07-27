import { mapWithLimit } from '@/server/concurrency';

/**
 * The politeness fence. Not a style preference: an unbounded fan-out
 * at a keyless upstream gets the whole worker's egress IP
 * rate-limited, and the reader who pays is the NEXT one, whose feed
 * 502s. Production, 27 July: 8 of 12 feed requests failed that way.
 */
describe('mapWithLimit', () => {
  /** Runs `count` tasks and reports the highest number ever in flight. */
  async function peakConcurrency(count: number, limit: number): Promise<number> {
    let live = 0;
    let peak = 0;
    await mapWithLimit(Array.from({ length: count }, (_, i) => i), limit, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
    });
    return peak;
  }

  test('never exceeds its limit, however much work arrives', async () => {
    expect(await peakConcurrency(40, 4)).toBeLessThanOrEqual(4);
    expect(await peakConcurrency(200, 1)).toBe(1);
  });

  test('uses the whole allowance — bounded is not serial', async () => {
    expect(await peakConcurrency(40, 4)).toBe(4);
  });

  test('answers in input order, whatever order the work finishes in', async () => {
    const out = await mapWithLimit([30, 5, 20, 1], 4, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return index;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  test('a pool, not a chunked barrier: a slow item never idles the pool', async () => {
    // One 60ms straggler among instant work. A chunk-and-barrier
    // implementation would stall the whole run behind it; a pool
    // keeps the other slot busy throughout.
    const started: number[] = [];
    await mapWithLimit([60, 1, 1, 1, 1, 1, 1, 1], 2, async (ms, index) => {
      started.push(index);
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
    expect(started).toHaveLength(8); // every item ran
    expect(started[started.length - 1]).toBe(7); // and the tail wasn't blocked
  });

  test('an empty list spawns no workers', async () => {
    await expect(mapWithLimit([], 4, async () => 1)).resolves.toEqual([]);
  });
});
