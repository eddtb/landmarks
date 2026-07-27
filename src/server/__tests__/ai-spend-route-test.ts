import { GET } from '@/app/api/ai-spend+api';

const originalNodeEnv = process.env.NODE_ENV;

function spendRequest(query = ''): Request {
  return new Request(`http://localhost/api/ai-spend${query}`);
}

describe('GET /api/ai-spend', () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.AI_SPEND_TOKEN;
  });

  test('answers freely outside production', async () => {
    const response = await GET(spendRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('gemini');
  });

  test('production without a configured token tells nobody', async () => {
    process.env.NODE_ENV = 'production';
    expect((await GET(spendRequest())).status).toBe(404);
    expect((await GET(spendRequest('?token=guess'))).status).toBe(404);
  });

  test('production answers only the configured token', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AI_SPEND_TOKEN = 'edd-only';
    expect((await GET(spendRequest())).status).toBe(404);
    expect((await GET(spendRequest('?token=wrong'))).status).toBe(404);
    expect((await GET(spendRequest('?token=edd-only'))).status).toBe(200);
  });
});
