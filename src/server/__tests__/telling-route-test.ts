import { POST } from '@/app/api/telling+api';

// The route's own behaviour is validation and keying — the generation
// behind it is telling-test.ts's subject
jest.mock('@/server/telling', () => ({
  getTelling: jest.fn(async () => 'A telling.'),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getTelling } = require('@/server/telling') as { getTelling: jest.Mock };

function tellingRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/telling', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const goodBody = {
  pageId: 9001,
  title: 'Borough Compter',
  extract: 'A small prison in Southwark, demolished in 1855.',
  source: 'Wikipedia',
};

describe('POST /api/telling', () => {
  beforeEach(() => {
    getTelling.mockClear();
  });

  test('tells a well-formed story request', async () => {
    const response = await POST(tellingRequest(goodBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ telling: 'A telling.' });
    expect(getTelling).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 9001, title: 'Borough Compter' }),
      '9001'
    );
  });

  test('areas cache under their name, not a pageId', async () => {
    const { pageId: _dropped, ...areaBody } = { ...goodBody, area: 'Greenwich' };
    const response = await POST(tellingRequest(areaBody));
    expect(response.status).toBe(200);
    expect(getTelling).toHaveBeenCalledWith(expect.anything(), 'area:greenwich');
  });

  test('rejects malformed JSON and missing fields without spending', async () => {
    expect((await POST(tellingRequest('not json'))).status).toBe(400);
    expect((await POST(tellingRequest({ title: 'No id' }))).status).toBe(400);
    expect((await POST(tellingRequest({ pageId: 9001, title: 'No extract' }))).status).toBe(400);
    expect((await POST(tellingRequest({ ...goodBody, pageId: '9001' }))).status).toBe(400);
    expect(getTelling).not.toHaveBeenCalled();
  });

  test('an empty extract is refused — the model never writes from nothing', async () => {
    const response = await POST(tellingRequest({ ...goodBody, extract: '   ' }));
    expect(response.status).toBe(422);
    expect(getTelling).not.toHaveBeenCalled();
  });

  test('oversized text is refused before it becomes a prompt', async () => {
    const bloated = { ...goodBody, extract: 'a'.repeat(16_001) };
    expect((await POST(tellingRequest(bloated))).status).toBe(413);
    const longTitle = { ...goodBody, title: 't'.repeat(301) };
    expect((await POST(tellingRequest(longTitle))).status).toBe(413);
    expect(getTelling).not.toHaveBeenCalled();
  });

  test('a declared oversize body is refused before parsing', async () => {
    const response = await POST(
      tellingRequest(goodBody, { 'content-length': String(1024 * 1024) })
    );
    expect(response.status).toBe(413);
    expect(getTelling).not.toHaveBeenCalled();
  });

  test('a generation failure is a 502, not a cached verdict', async () => {
    getTelling.mockRejectedValueOnce(new Error('upstream down'));
    expect((await POST(tellingRequest(goodBody))).status).toBe(502);
    getTelling.mockResolvedValueOnce('');
    expect((await POST(tellingRequest(goodBody))).status).toBe(502);
  });
});
