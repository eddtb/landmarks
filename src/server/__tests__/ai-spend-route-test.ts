/**
 * The bill is recon, so the gate is the TOKEN — never NODE_ENV. The
 * route used to open itself to anyone whose worker read a NODE_ENV
 * other than the exact literal 'production', which is the same shape
 * as the deploy that shipped without --environment production: a
 * variable nobody sets deliberately, deciding exposure.
 */

import { GET } from '@/app/api/ai-spend+api';

// A worker's NODE_ENV is whatever the platform put there — 'staging',
// empty, absent — not the three literals @types/node knows about, which
// is the whole reason it was the wrong thing to gate on
const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;

function spendRequest(query = ''): Request {
  return new Request(`http://localhost/api/ai-spend${query}`);
}

describe('GET /api/ai-spend', () => {
  beforeEach(() => {
    delete env.AI_SPEND_TOKEN;
    delete env.AI_SPEND_OPEN;
  });

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    delete env.AI_SPEND_TOKEN;
    delete env.AI_SPEND_OPEN;
  });

  test('nothing configured tells nobody, whatever NODE_ENV happens to say', async () => {
    for (const value of ['production', 'development', 'staging', '', undefined]) {
      env.NODE_ENV = value;
      expect((await GET(spendRequest())).status).toBe(404);
      expect((await GET(spendRequest('?token=guess'))).status).toBe(404);
    }
  });

  test('a configured token is the only way in — and NODE_ENV cannot open it', async () => {
    env.AI_SPEND_TOKEN = 'edd-only';
    env.NODE_ENV = 'staging';

    expect((await GET(spendRequest())).status).toBe(404);
    expect((await GET(spendRequest('?token=wrong'))).status).toBe(404);
    expect((await GET(spendRequest('?token=edd-only'))).status).toBe(200);
  });

  test('the token still answers in production', async () => {
    env.AI_SPEND_TOKEN = 'edd-only';
    env.NODE_ENV = 'production';

    expect((await GET(spendRequest('?token=edd-only'))).status).toBe(200);
  });

  test('reading it locally is a deliberate act: AI_SPEND_OPEN, never a guess at the environment', async () => {
    env.AI_SPEND_OPEN = '1';
    env.NODE_ENV = 'development';

    const response = await GET(spendRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('gemini');
  });

  test('a configured token outranks the dev flag — a worker with both stays shut', async () => {
    env.AI_SPEND_TOKEN = 'edd-only';
    env.AI_SPEND_OPEN = '1';

    expect((await GET(spendRequest())).status).toBe(404);
    expect((await GET(spendRequest('?token=edd-only'))).status).toBe(200);
  });
});
