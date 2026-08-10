import { fixtureSlug, fixturesEnabled, readFixture } from '@/server/fixtures';
import {
  getRetold,
  peekRetold,
  retellingInFlight,
  RetoldStreamEvent,
  startRetoldStream,
} from '@/server/retold';
import { storeHealthHeaders } from '@/server/telling-store';

/**
 * GET /api/retold?area=Greenwich
 *
 * The area's story retold in parts — one free-tier call per area per
 * month, cached. 404 means "show the original article instead": the
 * retelling improves the read, it never gates it.
 *
 * Content-negotiated dual mode (the Storyteller contract): a cache
 * hit — and every fixture and replay answer — is today's exact
 * application/json response. Only a COLD generation streams, and only
 * to a client that asked for it (Accept: text/event-stream): parts
 * land as SSE events while the model writes, the finished telling is
 * cached only when it parses valid, and the next open is a JSON hit.
 */

/**
 * The same 300 the telling route caps its title at, for the same
 * reason and a sharper one. This is the most expensive call in the app
 * — ~4,500 tokens over up to 24,000 source chars — and alone among the
 * three its cache key is whatever the caller typed: no source digest
 * binds it, because the source is fetched here rather than sent, and
 * unlike the quiz's the name is not resolved server-side either.
 * Uncapped, ~300 crafted GETs drain the SHARED daily Gemini ledger and
 * refuse every real reader on retold, telling AND quiz for the rest of
 * the day, each one writing an unbounded key into Turso and the
 * per-isolate map on its way past.
 */
const MaxAreaChars = 300;

/**
 * A real area name is a Wikipedia article title the app got from
 * /api/area — the only way the client ever produces one. Control
 * characters are nobody's neighbourhood and a name with no letter in
 * it is not a place; both are refused here, before they cost a
 * Wikipedia fetch, let alone a generation.
 */
function plausibleArea(area: string): boolean {
  if (area.length > MaxAreaChars) {
    return false;
  }
  // At least one letter in any script — Wikipedia titles are not all
  // Latin — and no control characters anywhere in it.
  return /\p{L}/u.test(area) && !/[\u0000-\u001f\u007f]/.test(area);
}

export async function GET(request: Request) {
  // Trimmed before anything else reads it: the key we accept is the
  // key we write, and " Greenwich " must not buy a second Turso row
  const area = (new URL(request.url).searchParams.get('area') ?? '').trim();
  if (!area) {
    return Response.json({ error: 'Expected area' }, { status: 400 });
  }
  if (!plausibleArea(area)) {
    return Response.json({ error: 'Not an area name' }, { status: 400 });
  }

  // Hermetic E2E: recorded retelling; missing keeps today's 404
  // ("show the original article instead" — never gates the read).
  // Always JSON — CI never streams.
  if (fixturesEnabled()) {
    const fixture = readFixture<{ retold: unknown }>(`retold-${fixtureSlug(area)}`);
    if (!fixture) {
      return Response.json({ error: 'No retelling available' }, { status: 404 });
    }
    return Response.json(fixture);
  }

  const wantsStream = (request.headers.get('accept') ?? '').includes('text/event-stream');
  if (wantsStream && peekRetold(area) === undefined && !retellingInFlight(area)) {
    try {
      const started = await startRetoldStream(area);
      if (started.kind === 'unavailable') {
        return Response.json(
          { error: 'No retelling available' },
          { status: 404, headers: storeHealthHeaders() }
        );
      }
      if (started.kind === 'stream') {
        return sseResponse(started.events);
      }
      // 'join': another request is mid-generation — fall through and
      // share its one call as JSON
    } catch (error) {
      // The breaker (or REPLAY_ONLY) refused before the stream opened
      console.error('Retold failed:', error);
      return Response.json(
        { error: 'Retold failed' },
        { status: 502, headers: storeHealthHeaders() }
      );
    }
  }

  try {
    const retold = await getRetold(area);
    if (!retold) {
      return Response.json(
        { error: 'No retelling available' },
        { status: 404, headers: storeHealthHeaders() }
      );
    }
    return Response.json({ retold }, { headers: storeHealthHeaders() });
  } catch (error) {
    console.error('Retold failed:', error);
    return Response.json(
      { error: 'Retold failed' },
      { status: 502, headers: storeHealthHeaders() }
    );
  }
}

/** The cold generation on the wire: one SSE frame per complete event. */
function sseResponse(events: AsyncGenerator<RetoldStreamEvent, void, void>): Response {
  const encoder = new TextEncoder();
  // After cancel() the controller refuses writes — every touch guards
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          if (cancelled) {
            return;
          }
          const { kind, ...data } = event;
          controller.enqueue(encoder.encode(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`));
        }
      } catch (error) {
        // Headers are long gone — the in-band failed frame is the 502
        console.error('Retold stream failed:', error);
        if (!cancelled) {
          controller.enqueue(encoder.encode('event: failed\ndata: {"reason":"interrupted"}\n\n'));
        }
      }
      if (!cancelled) {
        controller.close();
      }
    },
    cancel() {
      // The client went away — release the generation (nothing caches)
      cancelled = true;
      void events.return(undefined);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      // Read at open, which is the only moment headers exist — a cold
      // generation is exactly the request that will try to WRITE
      ...storeHealthHeaders(),
    },
  });
}
