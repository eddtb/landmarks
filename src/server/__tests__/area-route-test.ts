/**
 * The route's own behaviour is validation and reporting — the cascade
 * that finds the name is area-test.ts's subject. It earns a test file
 * of its own because it is the cheapest URL to curl after a deploy:
 * the area cache rides the same Turso table as everything else, so
 * this answer carries the store's health with it.
 */

import { GET } from '@/app/api/area+api';
import { findNearestArea } from '@/server/area';

jest.mock('@/server/area', () => ({ findNearestArea: jest.fn() }));

const mockFindNearestArea = findNearestArea as jest.Mock;

function ask(query = '?lat=51.4826&lng=-0.0077'): Request {
  return new Request(`http://localhost/api/area${query}`);
}

beforeEach(() => {
  mockFindNearestArea.mockReset();
  delete process.env.E2E_FIXTURES;
  // The store is off in CI, so 'off' is the health these answers report
  delete process.env.TURSO_DATABASE_URL;
});

describe('GET /api/area', () => {
  test('a name comes back with the store health beside it', async () => {
    mockFindNearestArea.mockResolvedValue('Greenwich');

    const response = await GET(ask());

    expect(await response.json()).toEqual({ name: 'Greenwich' });
    expect(response.headers.get('x-feed-store')).toBe('off');
  });

  test('no area article here is a real answer, and still reports', async () => {
    mockFindNearestArea.mockResolvedValue(null);

    const response = await GET(ask());

    expect(response.status).toBe(200);
    expect(response.headers.get('x-feed-store')).toBe('off');
  });

  test('a lookup we could not make is a 502 that still reports', async () => {
    mockFindNearestArea.mockRejectedValue(new Error('Wikidata rate-limited'));

    const response = await GET(ask());

    expect(response.status).toBe(502);
    expect(response.headers.get('x-feed-store')).toBe('off');
  });

  test('coordinates that are not numbers never reach the cascade', async () => {
    expect((await GET(ask('?lat=here&lng=there'))).status).toBe(400);
    expect((await GET(ask('?lat=51.4826&lng=nowhere'))).status).toBe(400);
    expect(mockFindNearestArea).not.toHaveBeenCalled();
  });
});
