import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShapeHitTesting } from './shape-hit-testing';
import { getShapeBounds } from './geometry';

describe('renderer-based selection hit testing', () => {
  it('includes the full width and end caps of native LC lines when rasterizing', () => {
    expect(
      getShapeBounds({
        className: 'Line',
        x1: 240,
        y1: 90,
        x2: 40,
        y2: 90,
        strokeWidth: 12,
        getBoundingRect: () => ({ x: 34, y: 84, width: 206, height: 6 }),
      })
    ).toEqual({ x: 34, y: 84, width: 212, height: 12 });
  });

  it('includes rotated rectangle stroke corners in raster bounds', () => {
    const bounds = getShapeBounds({
      className: 'Rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      strokeWidth: 10,
      rotation: Math.PI / 4,
      getBoundingRect: () => ({}),
    });
    expect(bounds?.width).toBeCloseTo(170 / Math.sqrt(2));
    expect(bounds?.height).toBeCloseTo(170 / Math.sqrt(2));
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const render = vi.fn((snapshot) => {
      const pixels = new Uint8ClampedArray(20 * 20 * 4);
      for (const [x, y] of snapshot.shapes[0].pixels) pixels[(y * 20 + x) * 4 + 3] = 255;
      return {
        width: 20,
        height: 20,
        getContext: () => ({ getImageData: () => ({ data: pixels }) }),
      };
    });
    vi.stubGlobal('LC', { shapeToJSON: (shape: unknown) => shape, renderSnapshotToImage: render });
    const shape = (className: string, pixels: number[][]) => ({
      className,
      pixels,
      getBoundingRect: () => ({ x: 0, y: 0, width: 20, height: 20 }),
    });
    return { hits: new ShapeHitTesting(), shape, render };
  }

  it('lets clicks pass through transparent fill pixels to strokes below', () => {
    const { hits, shape } = setup();
    const stroke = shape('LinePath', [[5, 5]]);
    const fill = shape('Image', [[15, 15]]);
    expect(hits.hit([stroke, fill], { x: 5, y: 5 }, 0)).toBe(stroke);
    expect(hits.hit([stroke, fill], { x: 15, y: 15 }, 0)).toBe(fill);
    expect(hits.hit([stroke, fill], { x: 10, y: 10 }, 0)).toBeNull();
  });

  it('selects every overlapping object independently rather than only the topmost one', () => {
    const { hits, shape } = setup();
    const stroke = shape('LinePath', [[5, 5]]);
    const fill = shape('Image', [[5, 5]]);
    for (const object of [stroke, fill]) {
      expect(hits.intersects(object, { x: 0, y: 0 }, { x: 10, y: 10 }, 'rectangle', [])).toBe(true);
    }
    expect(hits.hit([stroke, fill], { x: 5, y: 5 }, 0)).toBe(fill);
  });

  it('does not skip a one-pixel stroke or select an empty bounding-box corner', () => {
    const { hits, shape } = setup();
    const stroke = shape('LinePath', [[19, 19]]);
    expect(hits.intersects(stroke, { x: 18, y: 18 }, { x: 20, y: 20 }, 'rectangle', [])).toBe(true);
    expect(hits.intersects(stroke, { x: 0, y: 0 }, { x: 5, y: 5 }, 'rectangle', [])).toBe(false);
  });

  it('automatically supports future shape renderers without class-name hit-testing branches', () => {
    const { hits, shape } = setup();
    const future = shape('NewPluginShape', [[5, 5]]);
    expect(hits.hit([future], { x: 5, y: 5 }, 0)).toBe(future);
    expect(hits.intersects(future, { x: 0, y: 0 }, { x: 10, y: 10 }, 'circle', [])).toBe(true);
  });

  it('caches raster reads until drawing changes invalidate them', () => {
    const { hits, shape, render } = setup();
    const stroke = shape('LinePath', [[5, 5]]);
    hits.hit([stroke], { x: 5, y: 5 }, 0);
    hits.hit([stroke], { x: 5, y: 5 }, 0);
    expect(render).toHaveBeenCalledOnce();
    hits.clear();
    hits.hit([stroke], { x: 5, y: 5 }, 0);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('bounds fill selection controls by opaque content rather than transparent image margins', () => {
    const { hits, shape } = setup();
    const fill = shape('Image', [
      [5, 6],
      [8, 9],
    ]);
    expect(hits.visibleBounds(fill)).toEqual({ x: 5, y: 6, width: 4, height: 4 });
    expect(hits.visibleBounds(shape('Image', []))).toBeNull();
  });
});
