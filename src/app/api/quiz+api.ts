import { MinStoriesToQuiz, QuizSubject, getQuiz } from '@/server/quiz';

/**
 * POST because the client sends the stories: the server holds no
 * per-area state — history lists are fetched by location and cached on
 * the device, so the ground's own stories ride in with the request.
 *
 * Those stories used to be digested into the cache key, which meant a
 * fabricated body could only ever poison its own slot. #280 removed the
 * digest — the key is the area alone, because keying on the material
 * keyed the quiz to the ~111m feed bucket and re-spent the free tier on
 * every walk. The stories are MATERIAL now, and the guard went with the
 * digest: a crafted body writes the slot every real client in that area
 * reads for 30 days, and its titles render as options. That is a real
 * regression, taken deliberately — the defect it replaces is certain and
 * daily, this one needs an attacker — and it is tracked in #303, not
 * buried here. Recorded in AGENTS.md's call-site table too.
 */

const MaxTitleChars = 300;
const MaxExtractChars = 4_000;
/**
 * The nearest dozen is all quiz.ts will read, so anything past this is
 * simply ignored. It is NOT a rejection: a client sending its whole feed
 * is not abusing anything, and refusing at 40 made the Quiz tab fail
 * outright in every dense area — Deptford answers with 96 stories, so
 * the tab said "Couldn't set the quiz right now" on a real phone while
 * this route tested clean against a hand-made twelve. MaxBodyBytes is
 * what guards against an actual flood.
 */
const MaxStories = 60;
const MaxBodyBytes = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  const declaredBytes = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > MaxBodyBytes) {
    return Response.json({ error: 'Body too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { area, stories } = body as Record<string, unknown>;

  if (typeof area !== 'string' || !area.trim()) {
    return Response.json({ error: 'area is required' }, { status: 400 });
  }
  if (!Array.isArray(stories)) {
    return Response.json({ error: 'stories is required' }, { status: 400 });
  }
  const subjects: QuizSubject[] = [];
  for (const raw of stories.slice(0, MaxStories)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const { pageId, title, extract } = raw as Record<string, unknown>;
    if (typeof pageId !== 'number' || typeof title !== 'string' || typeof extract !== 'string') {
      continue;
    }
    subjects.push({
      pageId,
      title: title.slice(0, MaxTitleChars),
      extract: extract.slice(0, MaxExtractChars),
    });
  }

  // The floor is a 200, not an error: "no quiz for this ground" is a
  // real answer the tab is built to show, not a failure to report
  if (subjects.length < MinStoriesToQuiz) {
    return Response.json({ quiz: null });
  }

  try {
    const quiz = await getQuiz(area.slice(0, MaxTitleChars), subjects);
    return Response.json({ quiz });
  } catch (error) {
    console.error('Quiz failed:', error);
    return Response.json({ error: 'Quiz failed' }, { status: 502 });
  }
}
