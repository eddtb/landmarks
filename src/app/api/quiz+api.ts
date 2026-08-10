import { fixturesEnabled } from '@/server/fixtures';
import { getQuiz } from '@/server/quiz';
import { storeHealthHeaders } from '@/server/telling-store';

/**
 * GET /api/quiz?lat=51.4826&lng=-0.0077
 *
 * Five questions about the ground under these coordinates. `{ quiz:
 * null }` is a real answer, not an error — plenty of ground has no
 * named area or too little recorded history to ask about, and the tab
 * is built to say so.
 *
 * A GET with no body, because there is no longer anything to send.
 * This was a POST carrying the client's own stories, which made the
 * material — and therefore the model's prompt and the which-place
 * options rendered back on screen — whatever the caller wrote (#303).
 * The server derives its own stories now, from the coordinates, the
 * way /api/retold derives its own source from the area. Nothing left
 * in the request needs validating beyond "are these two numbers a
 * place on Earth", so nothing else is validated: the strings that
 * become cache keys and prompt text are ours.
 *
 * The two numbers are still attacker-choosable, so the key space is
 * still worth thinking about — but it is CLOSED. Coordinates resolve
 * through findNearestArea to a Wikipedia title Wikidata classes as an
 * area, or to nothing; no request can mint a key outside that set, and
 * the shared free-tier breaker remains the backstop for volume.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const latParam = url.searchParams.get('lat');
  const lngParam = url.searchParams.get('lng');
  // NaN for absent, never 0: Number(null) is Null Island, and a request
  // with no coordinates at all must be a 400 rather than a quiz about
  // the Gulf of Guinea.
  const lat = latParam ? Number(latParam) : NaN;
  const lng = lngParam ? Number(lngParam) : NaN;

  // Finite AND on the globe: a request for lat 1e12 can only ever cost
  // an upstream round trip to be told nothing is there.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: 'Expected lat and lng' }, { status: 400 });
  }

  // Hermetic E2E: the runner's IP gets 429'd by Wikipedia and Wikidata,
  // and "no quiz for this ground" is a verdict the tab already knows
  // how to show — words and a way onward, never a blank screen. Same
  // bargain /api/area strikes: byte-stable recorded flows, no fixture
  // to maintain.
  if (fixturesEnabled()) {
    return Response.json({ quiz: null });
  }

  try {
    const quiz = await getQuiz({ latitude: lat, longitude: lng });
    return Response.json({ quiz }, { headers: storeHealthHeaders() });
  } catch (error) {
    console.error('Quiz failed:', error);
    return Response.json({ error: 'Quiz failed' }, { status: 502, headers: storeHealthHeaders() });
  }
}
