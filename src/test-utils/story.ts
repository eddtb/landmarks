import { HistoryItem } from '@/types/history';

/**
 * The one story() factory (issue #200: four drifted copies became
 * this). Defaults describe a complete, visitable Wikipedia story at
 * the Royal Observatory — a photo to recognise it by, no pastTag —
 * so a bare story() passes every "qualifies" filter. A test that is
 * ABOUT a field overrides that field.
 */
export function story(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    pageId: 1,
    title: 'Royal Observatory',
    coordinates: { latitude: 51.4779, longitude: -0.0015 },
    distanceMeters: 400,
    thumbnailUrl: 'https://img/x.jpg',
    url: 'https://example.org/story',
    source: 'Wikipedia',
    ...overrides,
  };
}
