import { TileSizeDegrees, tileKey, tileKeysCovering } from '@/utils/tiles';

describe('tileKey', () => {
  it('bins a point to its cell south-west corner', () => {
    // Greenwich: 51.482 floors to 51.45; -0.008 floors to -0.05
    expect(tileKey({ latitude: 51.482, longitude: -0.008 })).toBe('51.45,-0.05');
  });

  it('keeps a boundary point in its own cell despite float drift', () => {
    // 51.45 / 0.05 is 1028.999999… in floats; a bare floor would say 51.40
    expect(tileKey({ latitude: 51.45, longitude: -0.05 })).toBe('51.45,-0.05');
    expect(tileKey({ latitude: 51.5, longitude: 0.1 })).toBe('51.50,0.10');
  });

  it('floors negatives southward and westward, never toward zero', () => {
    // Trafalgar Square: -0.128 is in the cell starting at -0.15, not -0.10
    expect(tileKey({ latitude: 51.508, longitude: -0.128 })).toBe('51.50,-0.15');
  });

  it('formats the zero cell without a minus sign', () => {
    expect(tileKey({ latitude: 51.5, longitude: 0.01 })).toBe('51.50,0.00');
  });
});

describe('tileKeysCovering', () => {
  const greenwich = { latitude: 51.482, longitude: -0.008 };

  it('always includes the tile the point stands in', () => {
    for (const radius of [100, 1500, 3000]) {
      expect(tileKeysCovering(greenwich, radius)).toContain(tileKey(greenwich));
    }
  });

  it('covers one tile for a small radius mid-cell', () => {
    // Mid-cell point: 51.475 sits centrally in the 51.45 row
    const keys = tileKeysCovering({ latitude: 51.475, longitude: -0.025 }, 200);
    expect(keys).toEqual([tileKey({ latitude: 51.475, longitude: -0.025 })]);
  });

  it('spans neighbours across a cell corner', () => {
    // Just inside a cell's south-west corner: the feed radius reaches
    // the row below and the column to the west
    const keys = tileKeysCovering({ latitude: 51.4501, longitude: -0.0499 }, 2500);
    expect(keys).toContain('51.45,-0.05');
    expect(keys).toContain('51.40,-0.05');
    expect(keys).toContain('51.45,-0.10');
    expect(keys).toContain('51.40,-0.10');
    expect(keys).toHaveLength(4);
  });

  it('never repeats a key', () => {
    const keys = tileKeysCovering(greenwich, 3000);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('stays bounded at the sparse horizon', () => {
    // 3 km covers at most 2 rows and 3 columns at UK latitudes
    expect(tileKeysCovering(greenwich, 3000).length).toBeLessThanOrEqual(6);
  });

  it('agrees with tileKey along a walk across a boundary', () => {
    // Every point of a northward walk must find its own tile inside
    // the covering of the previous point at walking-refresh distance
    for (let step = 0; step < 20; step++) {
      const at = { latitude: 51.448 + step * 0.0005, longitude: -0.008 };
      const next = { latitude: at.latitude + 0.0005, longitude: at.longitude };
      expect(tileKeysCovering(at, 200)).toContain(tileKey(next));
    }
  });

  it('uses the documented cell size', () => {
    // The key format hard-codes two decimals; 0.05 is the only size
    // that keeps "<south>,<west>" exact at two decimals
    expect(TileSizeDegrees).toBe(0.05);
  });
});
