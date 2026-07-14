import { renderHook } from '@testing-library/react-native';

import { useFetchAnchor } from '@/hooks/use-fetch-anchor';

describe('useFetchAnchor', () => {
  test('holds the anchor for small movements, moves it after ~250m', async () => {
    const start = { latitude: 51.5, longitude: -0.09 };
    const { result, rerender } = await renderHook(
      (props: { coords: typeof start }) => useFetchAnchor(props.coords),
      { initialProps: { coords: start } }
    );

    expect(result.current).toEqual(start);

    // ~100m north: anchor must not move (no refetch)
    const nearby = { latitude: 51.501, longitude: -0.09 };
    await rerender({ coords: nearby });
    expect(result.current).toEqual(start);

    // ~330m north: anchor jumps to the new position
    const farther = { latitude: 51.503, longitude: -0.09 };
    await rerender({ coords: farther });
    expect(result.current).toEqual(farther);
  });
});
