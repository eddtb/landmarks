import { fetch } from 'expo/fetch';

import { ApiError } from '@/data/cached-get';
import { fetchRetold, RetoldInterruptedError } from '@/data/retold-client';
import { makeSseFrameReader } from '@/data/sse';
import { Retold, RetoldPart } from '@/types/retold';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const mockFetch = fetch as unknown as jest.Mock;

const telling: Retold = {
  parts: [
    { heading: 'One', body: 'First.' },
    { heading: 'Two', body: 'Second.' },
    { heading: 'Three', body: 'Third.' },
  ],
  minutes: 1,
  timeline: [],
};

/** The wire as expo/fetch sees it: an SSE body arriving in chunks. */
function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const queue = chunks.map((chunk) => encoder.encode(chunk));
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader: () => ({
        read: async () =>
          queue.length > 0 ? { done: false, value: queue.shift() } : { done: true, value: undefined },
      }),
    },
  };
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('makeSseFrameReader (frames across any chunking)', () => {
  test('a frame surfaces only when its blank-line terminator lands', () => {
    const reader = makeSseFrameReader();
    expect(reader.feed('event: part\ndata: {"index":0}')).toEqual([]);
    expect(reader.feed('\n')).toEqual([]);
    expect(reader.feed('\n')).toEqual([{ event: 'part', data: '{"index":0}' }]);
  });

  test('several frames in one chunk all surface, in order', () => {
    const reader = makeSseFrameReader();
    expect(reader.feed(frame('part', { index: 0 }) + frame('done', {}))).toEqual([
      { event: 'part', data: '{"index":0}' },
      { event: 'done', data: '{}' },
    ]);
  });

  test('byte-by-byte chunking loses nothing', () => {
    const wire = frame('part', { index: 0 }) + frame('failed', { reason: 'interrupted' });
    const reader = makeSseFrameReader();
    const frames = [...wire].flatMap((char) => reader.feed(char));
    expect(frames.map((got) => got.event)).toEqual(['part', 'failed']);
  });
});

describe('fetchRetold (dual transport)', () => {
  test('a JSON answer (server cache hit) resolves whole and is session-cached', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ retold: telling }),
    });

    expect(await fetchRetold('Greenwich')).toEqual(telling);
    expect(await fetchRetold('Greenwich')).toEqual(telling); // session cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // The client asks for either transport; the server chooses
    expect(mockFetch.mock.calls[0][1]).toEqual({
      headers: { Accept: 'text/event-stream, application/json' },
    });
  });

  test('a streamed answer surfaces parts as they complete, resolves with the finished telling', async () => {
    const wire =
      frame('part', { index: 0, part: telling.parts[0] }) +
      frame('part', { index: 1, part: telling.parts[1] }) +
      frame('part', { index: 2, part: telling.parts[2] }) +
      frame('done', { retold: telling });
    // Chunk boundaries deliberately mid-frame
    mockFetch.mockResolvedValue(sseResponse([wire.slice(0, 45), wire.slice(45, 130), wire.slice(130)]));

    const seen: [number, string][] = [];
    const finished = await fetchRetold('Deptford', (part: RetoldPart, index: number) =>
      seen.push([index, part.heading])
    );
    expect(seen).toEqual([
      [0, 'One'],
      [1, 'Two'],
      [2, 'Three'],
    ]);
    expect(finished).toEqual(telling);

    // The finished telling is session-cached — one wire ask total
    expect(await fetchRetold('Deptford')).toEqual(telling);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('an in-band failed frame throws, keeps the arrived count, caches nothing', async () => {
    mockFetch.mockResolvedValue(
      sseResponse([
        frame('part', { index: 0, part: telling.parts[0] }) + frame('failed', { reason: 'interrupted' }),
      ])
    );

    await expect(fetchRetold('Lewisham')).rejects.toThrow(RetoldInterruptedError);
    // Nothing cached: a retry truly re-asks
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ retold: telling }),
    });
    expect(await fetchRetold('Lewisham')).toEqual(telling);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('a connection that dies without a verdict is an interruption too', async () => {
    mockFetch.mockResolvedValue(sseResponse([frame('part', { index: 0, part: telling.parts[0] })]));

    await expect(fetchRetold('Blackheath')).rejects.toThrow(RetoldInterruptedError);
  });

  test('a 404 stays an ApiError with its status — the "no retelling" verdict', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    await expect(fetchRetold('Nowhere')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    });
    expect((await fetchRetold('Nowhere').catch((error) => error)) instanceof ApiError).toBe(true);
  });
});
