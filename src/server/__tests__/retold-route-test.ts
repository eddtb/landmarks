/**
 * GET /api/retold — the content-negotiated dual mode. A cache hit (and
 * every fixture answer) is today's exact application/json response;
 * only a cold generation streams, and only to a client that asked for
 * it. The Storyteller contract: REPLAY_ONLY and CI never see SSE.
 */

import { GET } from '@/app/api/retold+api';
import {
  getRetold,
  peekRetold,
  retellingInFlight,
  RetoldStreamEvent,
  startRetoldStream,
} from '@/server/retold';
import { Retold } from '@/types/retold';

jest.mock('@/server/retold', () => ({
  getRetold: jest.fn(),
  peekRetold: jest.fn(),
  retellingInFlight: jest.fn(() => false),
  startRetoldStream: jest.fn(),
}));

// Same guarded require as story-route-test: node-only test, app
// tsconfig has no node types
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mkdtempSync, writeFileSync, rmSync } = require('fs') as {
  mkdtempSync: (prefix: string) => string;
  writeFileSync: (path: string, data: string) => void;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { tmpdir } = require('os') as { tmpdir: () => string };

const mockGetRetold = getRetold as jest.Mock;
const mockPeek = peekRetold as jest.Mock;
const mockInFlight = retellingInFlight as jest.Mock;
const mockStart = startRetoldStream as jest.Mock;

const telling: Retold = {
  parts: [
    { heading: 'One', body: 'First.' },
    { heading: 'Two', body: 'Second.' },
    { heading: 'Three', body: 'Third.' },
  ],
  minutes: 1,
  timeline: [],
  brief: [],
};

function ask(accept?: string): Request {
  return new Request(
    'http://localhost/api/retold?area=Greenwich',
    accept ? { headers: { Accept: accept } } : undefined
  );
}

async function* streamOf(events: RetoldStreamEvent[]): AsyncGenerator<RetoldStreamEvent, void, void> {
  for (const event of events) {
    yield event;
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPeek.mockReturnValue(undefined);
  mockInFlight.mockReturnValue(false);
  delete process.env.E2E_FIXTURES;
  // The store is off in CI, so 'off' is the health these answers report
  delete process.env.TURSO_DATABASE_URL;
});

describe('GET /api/retold — content negotiation', () => {
  test('a CACHE HIT stays exact JSON, even for a streaming client', async () => {
    mockPeek.mockReturnValue({ retold: telling });
    mockGetRetold.mockResolvedValue(telling);

    const response = await GET(ask('text/event-stream, application/json'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ retold: telling });
    expect(mockStart).not.toHaveBeenCalled();
  });

  test('a client that never asked for a stream gets JSON, even cold', async () => {
    mockGetRetold.mockResolvedValue(telling);

    const response = await GET(ask());
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ retold: telling });
    expect(mockStart).not.toHaveBeenCalled();
  });

  test('COLD + streaming client: parts flow as SSE frames, then done', async () => {
    mockStart.mockResolvedValue({
      kind: 'stream',
      events: streamOf([
        { kind: 'part', index: 0, part: telling.parts[0] },
        { kind: 'part', index: 1, part: telling.parts[1] },
        { kind: 'part', index: 2, part: telling.parts[2] },
        { kind: 'done', retold: telling },
      ]),
    });

    const response = await GET(ask('text/event-stream'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const wire = await response.text();
    const frames = wire.split('\n\n').filter(Boolean);
    expect(frames).toHaveLength(4);
    expect(frames[0]).toBe(`event: part\ndata: ${JSON.stringify({ index: 0, part: telling.parts[0] })}`);
    expect(frames[3]).toBe(`event: done\ndata: ${JSON.stringify({ retold: telling })}`);
    expect(mockGetRetold).not.toHaveBeenCalled();
  });

  test('an in-flight generation is shared as JSON, never a second stream', async () => {
    mockInFlight.mockReturnValue(true);
    mockGetRetold.mockResolvedValue(telling);

    const response = await GET(ask('text/event-stream'));
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(mockStart).not.toHaveBeenCalled();
  });

  test('the breaker (REPLAY_ONLY) refuses BEFORE any stream: a plain 502, nothing streamed', async () => {
    mockStart.mockRejectedValue(new Error('replay-only refuses'));

    const response = await GET(ask('text/event-stream'));
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  test('unavailable stays a 404 — the original article never gates on the stream', async () => {
    mockStart.mockResolvedValue({ kind: 'unavailable' });

    const response = await GET(ask('text/event-stream'));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  test('a mid-stream failure lands as an in-band failed frame after the parts that made it', async () => {
    mockStart.mockResolvedValue({
      kind: 'stream',
      events: streamOf([
        { kind: 'part', index: 0, part: telling.parts[0] },
        { kind: 'failed', reason: 'interrupted' },
      ]),
    });

    const wire = await (await GET(ask('text/event-stream'))).text();
    const frames = wire.split('\n\n').filter(Boolean);
    expect(frames[0]).toContain('event: part');
    expect(frames[1]).toBe('event: failed\ndata: {"reason":"interrupted"}');
  });
});

/**
 * The area is the whole cache key and the whole prompt, and nothing
 * upstream bounds it: alone among the three Gemini call-sites this
 * route's key is whatever the caller typed, because the source is
 * fetched here rather than sent. ~300 crafted GETs drain the SHARED
 * daily ledger and refuse every real reader on retold, telling AND
 * quiz until midnight.
 */
describe('GET /api/retold — what counts as an area', () => {
  function askFor(area: string): Request {
    return new Request(`http://localhost/api/retold?area=${encodeURIComponent(area)}`);
  }

  test('an area past the 300-char cap is refused before a single fetch', async () => {
    const response = await GET(askFor('a'.repeat(301)));

    expect(response.status).toBe(400);
    expect(mockGetRetold).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  test('a name with no letter in it is not a place', async () => {
    expect((await GET(askFor('12345'))).status).toBe(400);
    expect((await GET(askFor('---'))).status).toBe(400);
    expect(mockGetRetold).not.toHaveBeenCalled();
  });

  test('a control character is not part of any place name', async () => {
    expect((await GET(askFor('Green\u0000wich'))).status).toBe(400);
    expect((await GET(askFor('Greenwich\nMaritime'))).status).toBe(400);
    expect(mockGetRetold).not.toHaveBeenCalled();
  });

  test('a C1 control character is a control character too', async () => {
    // The original guard stopped at C0+DEL, and %C2%9B decodes to CSI
    // (U+009B) — a key with a control character in it, straight into
    // Turso and the prompt. Built with fromCharCode so no editor or
    // diff tool ever normalises the byte away.
    const csi = `Green${String.fromCharCode(0x9b)}wich`;
    const nel = `Green${String.fromCharCode(0x85)}wich`;

    expect((await GET(askFor(csi))).status).toBe(400);
    expect((await GET(askFor(nel))).status).toBe(400);
    expect(mockGetRetold).not.toHaveBeenCalled();
  });

  test('a joining script is not a control character — ZWJ names survive', async () => {
    mockGetRetold.mockResolvedValue(telling);
    // Sinhala uses ZWJ (Cf) inside real words; a guard that widened to
    // all of \p{C} would refuse a real place its retelling.
    const sinhala = `ශ්${String.fromCharCode(0x200d)}රී`;

    expect((await GET(askFor(sinhala))).status).toBe(200);
  });

  test('a real area name in any script still gets its retelling', async () => {
    mockGetRetold.mockResolvedValue(telling);

    expect((await GET(askFor('Greenwich, London'))).status).toBe(200);
    expect((await GET(askFor('東京'))).status).toBe(200);
    expect((await GET(askFor('a'.repeat(300)))).status).toBe(200);
  });

  test('surrounding whitespace never buys a second cache row', async () => {
    mockGetRetold.mockResolvedValue(telling);

    await GET(askFor('  Greenwich  '));

    // The key we accept is the key we write, in Turso and in the map
    expect(mockGetRetold).toHaveBeenCalledWith('Greenwich');
  });

  test('every answer carries the store health, hit or miss', async () => {
    mockGetRetold.mockResolvedValue(telling);
    const hit = await GET(askFor('Greenwich'));
    expect(hit.headers.get('x-feed-store')).toBe('off');

    mockGetRetold.mockResolvedValue(null);
    const miss = await GET(askFor('Greenwich'));
    expect(miss.status).toBe(404);
    expect(miss.headers.get('x-feed-store')).toBe('off');
  });

  test('…and so does a refusal — the header is unconditional', async () => {
    const refusal = await GET(askFor('12345'));

    expect(refusal.status).toBe(400);
    expect(refusal.headers.get('x-feed-store')).toBe('off');
  });

  test('…and the SSE open — the one moment a stream has headers', async () => {
    mockStart.mockResolvedValue({
      kind: 'stream',
      events: streamOf([{ kind: 'done', retold: telling }]),
    });

    const response = await GET(ask('text/event-stream'));

    expect(response.headers.get('content-type')).toBe('text/event-stream');
    // A cold generation is exactly the request that will try to WRITE
    // to the store; its health must ride the open, because there is
    // nowhere later to put it.
    expect(response.headers.get('x-feed-store')).toBe('off');
  });
});

describe('fixture mode (hermetic CI) never streams', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(`${tmpdir()}/retold-route-test-`);
    process.env.E2E_FIXTURES_DIR = dir;
    writeFileSync(`${dir}/retold-greenwich.json`, JSON.stringify({ retold: telling }));
  });

  afterAll(() => {
    delete process.env.E2E_FIXTURES;
    delete process.env.E2E_FIXTURES_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  test('a recorded retelling answers as JSON even to a streaming client', async () => {
    process.env.E2E_FIXTURES = '1';
    const response = await GET(ask('text/event-stream, application/json'));
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ retold: telling });
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockGetRetold).not.toHaveBeenCalled();
  });

  test('a missing fixture keeps the 404 — no live call from CI', async () => {
    process.env.E2E_FIXTURES = '1';
    const response = await GET(
      new Request('http://localhost/api/retold?area=Nowhere', {
        headers: { Accept: 'text/event-stream' },
      })
    );
    expect(response.status).toBe(404);
    expect(mockStart).not.toHaveBeenCalled();
  });
});
