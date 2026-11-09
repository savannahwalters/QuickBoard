import { describe, expect, it } from 'vitest';
import { pointInPolygon, pointInSelection } from './selection-geometry';

describe('selection geometry', () => {
  it('tests rectangular and elliptical regions', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 20, y: 10 };
    expect(pointInSelection({ x: 20, y: 10 }, start, end, 'rectangle', [])).toBe(true);
    expect(pointInSelection({ x: 20, y: 10 }, start, end, 'circle', [])).toBe(false);
    expect(pointInSelection({ x: 10, y: 5 }, start, end, 'circle', [])).toBe(true);
  });

  it('tests lasso regions and rejects incomplete polygons', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 4 }, triangle)).toBe(true);
    expect(pointInPolygon({ x: 1, y: 9 }, triangle)).toBe(false);
    expect(pointInPolygon({ x: 1, y: 1 }, triangle.slice(0, 2))).toBe(false);
  });
});
