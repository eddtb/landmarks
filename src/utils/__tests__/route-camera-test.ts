import { cameraForPins, cameraForRoute } from '@/utils/route-camera';

describe('cameraForRoute', () => {
  test('centers on the bounding box of the points', () => {
    const camera = cameraForRoute([
      { latitude: 51.5, longitude: -0.09 },
      { latitude: 51.51, longitude: -0.07 },
    ]);

    expect(camera?.coordinates.latitude).toBeCloseTo(51.505);
    expect(camera?.coordinates.longitude).toBeCloseTo(-0.08);
  });

  test('zooms out as the route gets longer', () => {
    const shortWalk = cameraForRoute([
      { latitude: 51.5, longitude: -0.09 },
      { latitude: 51.505, longitude: -0.09 },
    ]);
    const longWalk = cameraForRoute([
      { latitude: 51.5, longitude: -0.09 },
      { latitude: 51.53, longitude: -0.09 },
    ]);

    expect(shortWalk!.zoom).toBeGreaterThan(longWalk!.zoom);
  });

  test('a one-block hop does not over-zoom past the ceiling', () => {
    const camera = cameraForRoute([
      { latitude: 51.5, longitude: -0.09 },
      { latitude: 51.5001, longitude: -0.09 },
    ]);

    expect(camera!.zoom).toBeLessThanOrEqual(17);
  });

  test('a cross-city span clamps to the zoom floor', () => {
    const camera = cameraForRoute([
      { latitude: 51.4, longitude: -0.2 },
      { latitude: 51.6, longitude: 0.1 },
    ]);

    expect(camera!.zoom).toBe(12);
  });

  test('no points, no camera', () => {
    expect(cameraForRoute([])).toBeNull();
  });
});

/**
 * The pin camera exists because of a simulator screenshot: twelve pins
 * in a 220pt strip, and the northernmost one clipped clean off the top.
 * cameraForRoute derives zoom from WIDTH alone, which is fine for a
 * route in a square-ish card and wrong for a field of pins in a strip.
 */
describe('cameraForPins', () => {
  // The card the Nearby feed actually renders, measured on the sim
  const card = { widthPixels: 354, heightPixels: 220 };

  /** The latitude span the card can show at a given zoom. */
  const visibleLatSpan = (zoom: number, glyphPixels = 40) =>
    (360 * (card.heightPixels - glyphPixels * 2)) / (256 * 2 ** zoom);

  test('every pin fits the card HEIGHT, which is what a strip binds on', () => {
    // The Greenwich case: spread north-south, in a card three times wider
    // than it is tall
    const points = [
      { latitude: 51.4795, longitude: -0.0095 },
      { latitude: 51.4826, longitude: -0.0077 },
      { latitude: 51.4861, longitude: -0.0065 },
    ];
    const latSpan = 51.4861 - 51.4795;

    const camera = cameraForPins({ points, ...card })!;

    // Fits exactly, by construction — the glyph inset IS the margin, so
    // allow floating-point slack rather than demanding a strict >=
    expect(visibleLatSpan(camera.zoom)).toBeGreaterThan(latSpan * 0.999);
  });

  test('…where framing on width alone did not — the bug, pinned', () => {
    const points = [
      { latitude: 51.4795, longitude: -0.0095 },
      { latitude: 51.4861, longitude: -0.0065 },
    ];

    const pins = cameraForPins({ points, ...card })!;
    const route = cameraForRoute(points)!;

    // Strictly further out: the height needed more room than the width
    expect(pins.zoom).toBeLessThan(route.zoom);
  });

  test('a wide east-west spread is bound by the width instead', () => {
    const points = [
      { latitude: 51.4826, longitude: -0.02 },
      { latitude: 51.4827, longitude: 0.01 },
    ];
    const lngSpan = 0.03 * Math.cos((51.4826 * Math.PI) / 180);

    const camera = cameraForPins({ points, ...card })!;
    const visibleLngSpan = (360 * (card.widthPixels - 80)) / (256 * 2 ** camera.zoom);

    expect(visibleLngSpan).toBeGreaterThan(lngSpan * 0.999);
  });

  test('centers on the bounding box, not on any one pin', () => {
    const camera = cameraForPins({
      points: [
        { latitude: 51.5, longitude: -0.09 },
        { latitude: 51.51, longitude: -0.07 },
      ],
      ...card,
    });

    expect(camera?.coordinates.latitude).toBeCloseTo(51.505);
    expect(camera?.coordinates.longitude).toBeCloseTo(-0.08);
  });

  test('one pin does not zoom to the rooftops, and a city clamps to the floor', () => {
    const single = cameraForPins({ points: [{ latitude: 51.5, longitude: -0.09 }], ...card })!;
    expect(single.zoom).toBeLessThanOrEqual(17);

    const city = cameraForPins({
      points: [
        { latitude: 51.4, longitude: -0.2 },
        { latitude: 51.6, longitude: 0.1 },
      ],
      ...card,
    })!;
    expect(city.zoom).toBe(12);
  });

  test('a card measured at zero does not produce a NaN camera', () => {
    const camera = cameraForPins({
      points: [{ latitude: 51.5, longitude: -0.09 }],
      widthPixels: 0,
      heightPixels: 0,
    })!;

    expect(Number.isFinite(camera.zoom)).toBe(true);
  });

  test('no points, no camera', () => {
    expect(cameraForPins({ points: [], ...card })).toBeNull();
  });
});
