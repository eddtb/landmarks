import Constants from 'expo-constants';

import { apiUrl } from '@/data/api';

jest.mock('expo-constants', () => ({ expoConfig: null }));

describe('apiUrl', () => {
  const originalOrigin = process.env.EXPO_PUBLIC_API_ORIGIN;
  const mockedConstants = Constants as typeof Constants & {
    expoConfig: { hostUri?: string } | null;
  };

  afterEach(() => {
    mockedConstants.expoConfig = null;
    if (originalOrigin === undefined) {
      delete process.env.EXPO_PUBLIC_API_ORIGIN;
    } else {
      process.env.EXPO_PUBLIC_API_ORIGIN = originalOrigin;
    }
  });

  test('uses the hosted origin in a standalone build', () => {
    process.env.EXPO_PUBLIC_API_ORIGIN = 'https://venture.expo.app/';

    expect(apiUrl('/api/history')).toBe('https://venture.expo.app/api/history');
  });

  test('uses Metro when no hosted origin is configured', () => {
    delete process.env.EXPO_PUBLIC_API_ORIGIN;
    mockedConstants.expoConfig = {
      name: 'Venture',
      slug: 'landmarks',
      hostUri: '192.0.2.1:8081',
    };

    expect(apiUrl('/api/history')).toBe('http://192.0.2.1:8081/api/history');
  });

  test('keeps same-origin paths for hosted web routes', () => {
    delete process.env.EXPO_PUBLIC_API_ORIGIN;

    expect(apiUrl('/api/history')).toBe('/api/history');
  });
});
