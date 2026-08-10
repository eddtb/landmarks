import { POST } from '@/app/api/quiz+api';

/**
 * The route's own behaviour is validation and shaping — the generation
 * behind it is quiz-test.ts's subject.
 *
 * This file exists because of a bug that unit tests could not have
 * caught and a hand-made request hid: the route refused more than 40
 * stories with a 413, while the app sends its whole feed. Deptford
 * returns 96, so the Quiz tab failed outright in every dense area on a
 * real phone. A client sending everything it has is not abuse.
 */
jest.mock('@/server/quiz', () => ({
  ...(jest.requireActual('@/server/quiz') as object),
  getQuiz: jest.fn(async () => ({ areaName: 'Deptford', questions: [] })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getQuiz } = require('@/server/quiz') as { getQuiz: jest.Mock };

function quizRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const story = (pageId: number) => ({
  pageId,
  title: `Place ${pageId}`,
  extract: `The story of place ${pageId}.`,
});

const feed = (count: number) => Array.from({ length: count }, (_, i) => story(i + 1));

beforeEach(() => {
  getQuiz.mockClear();
});

describe('POST /api/quiz', () => {
  test('a whole dense-area feed is accepted, not refused', async () => {
    // The exact shape that failed on the phone
    const response = await POST(quizRequest({ area: 'Deptford', stories: feed(96) }));

    expect(response.status).toBe(200);
    expect(getQuiz).toHaveBeenCalled();
  });

  test('…and the surplus is ignored rather than read', async () => {
    await POST(quizRequest({ area: 'Deptford', stories: feed(96) }));

    const subjects = getQuiz.mock.calls[0][1] as unknown[];
    expect(subjects.length).toBeLessThanOrEqual(60);
    expect(subjects.length).toBeGreaterThanOrEqual(12);
  });

  test('too few stories is a 200 with no quiz — an answer, not an error', async () => {
    const response = await POST(quizRequest({ area: 'Nowhere', stories: feed(2) }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ quiz: null });
    // The floor is enforced before anything is spent
    expect(getQuiz).not.toHaveBeenCalled();
  });

  test('malformed stories are skipped, not fatal', async () => {
    const response = await POST(
      quizRequest({
        area: 'Deptford',
        stories: [...feed(12), null, 'nonsense', { pageId: 'not a number' }, { title: 'no id' }],
      })
    );

    expect(response.status).toBe(200);
    expect((getQuiz.mock.calls[0][1] as unknown[]).length).toBe(12);
  });

  test('an area is required, and invalid JSON is a 400', async () => {
    expect((await POST(quizRequest({ stories: feed(12) }))).status).toBe(400);
    expect((await POST(quizRequest({ area: '   ', stories: feed(12) }))).status).toBe(400);
    expect((await POST(quizRequest('{ not json'))).status).toBe(400);
  });

  test('a declared body past the byte cap is refused before parsing', async () => {
    const response = await POST(
      quizRequest({ area: 'Deptford', stories: feed(12) }, { 'content-length': String(9 * 1024 * 1024) })
    );

    expect(response.status).toBe(413);
  });

  test('a generation failure is a 502, not a silent empty quiz', async () => {
    getQuiz.mockRejectedValueOnce(new Error('breaker open'));

    const response = await POST(quizRequest({ area: 'Deptford', stories: feed(12) }));

    expect(response.status).toBe(502);
  });

  test('every answer says what the durable store is doing', async () => {
    delete process.env.TURSO_DATABASE_URL;
    const asked = quizRequest({ area: 'Deptford', stories: feed(12) });

    // Quizzes cache in the same table, so a curl at this route is as
    // good a post-deploy probe as a curl at the feed
    expect((await POST(asked)).headers.get('x-feed-store')).toBe('off');

    const thin = await POST(quizRequest({ area: 'Nowhere', stories: feed(2) }));
    expect(thin.headers.get('x-feed-store')).toBe('off');
  });
});
