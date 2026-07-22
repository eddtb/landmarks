import { fixtureSlug, fixturesEnabled, readFixture } from '@/server/fixtures';
import {
  getRetold,
  peekRetold,
  retellingInFlight,
  RetoldStreamEvent,
  startRetoldStream,
} from '@/server/retold';

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
export async function GET(request: Request) {
  const area = new URL(request.url).searchParams.get('area');
  if (!area) {
    return Response.json({ error: 'Expected area' }, { status: 400 });
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
        return Response.json({ error: 'No retelling available' }, { status: 404 });
      }
      if (started.kind === 'stream') {
        return sseResponse(started.events);
      }
      // 'join': another request is mid-generation — fall through and
      // share its one call as JSON
    } catch (error) {
      // The breaker (or REPLAY_ONLY) refused before the stream opened
      console.error('Retold failed:', error);
      return Response.json({ error: 'Retold failed' }, { status: 502 });
    }
  }

  try {
    const retold = await getRetold(area);
    if (!retold) {
      return Response.json({ error: 'No retelling available' }, { status: 404 });
    }
    return Response.json({ retold });
  } catch (error) {
    console.error('Retold failed:', error);
    return Response.json({ error: 'Retold failed' }, { status: 502 });
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
    },
  });
}
