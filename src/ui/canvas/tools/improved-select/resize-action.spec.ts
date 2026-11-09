import { afterEach, describe, expect, it, vi } from 'vitest';
import { resizeShapes, rotateShapes } from './resize-action';

describe('vector selection resizing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rotates pencil control points and smoothed points without rasterizing them', () => {
    const shape = {};
    vi.stubGlobal('LC', { JSONToShape: (snapshot: Record<string, unknown>) => snapshot['data'] });
    const data = {
      pointCoordinatePairs: [
        [10, 0],
        [20, 0],
      ],
      smoothedPointCoordinatePairs: [[15, 0]],
      pointSize: 5,
    };
    rotateShapes(new Map([[shape, { className: 'LinePath', data }]]), { x: 0, y: 0 }, Math.PI / 2);
    const rotated = shape as typeof data;
    expect(rotated.pointCoordinatePairs[0][0]).toBeCloseTo(0);
    expect(rotated.pointCoordinatePairs[0][1]).toBeCloseTo(10);
    expect(rotated.smoothedPointCoordinatePairs[0][1]).toBeCloseTo(15);
    expect(rotated.pointSize).toBe(5);
    expect(data.pointCoordinatePairs).toEqual([
      [10, 0],
      [20, 0],
    ]);
  });

  it('scales raw and smoothed stroke geometry without changing the saved original', () => {
    const shape = {};
    const data = {
      pointCoordinatePairs: [
        [10, 20],
        [20, 40],
      ],
      smoothedPointCoordinatePairs: [[12, 24]],
      pointSize: 5,
      pointColor: '#123456',
      smooth: true,
    };
    const snapshot = { className: 'LinePath', id: 'stroke', data };
    const restore = vi.fn((json) => json['data']);
    vi.stubGlobal('LC', { JSONToShape: restore });
    resizeShapes(new Map([[shape, snapshot]]), { x: 10, y: 20 }, 2, 3);
    expect(shape).toEqual({
      pointCoordinatePairs: [
        [10, 20],
        [30, 80],
      ],
      smoothedPointCoordinatePairs: [[14, 32]],
      pointSize: 10,
      pointColor: '#123456',
      smooth: true,
    });
    expect(data.pointCoordinatePairs).toEqual([
      [10, 20],
      [20, 40],
    ]);
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'stroke', className: 'LinePath' })
    );
  });

  it('scales polygon and square-brush points while retaining their styles', () => {
    const shape = {};
    vi.stubGlobal('LC', { JSONToShape: (json: Record<string, unknown>) => json['data'] });
    resizeShapes(
      new Map([
        [
          shape,
          {
            className: 'Polygon',
            data: {
              points: [
                { className: 'Point', data: { x: 20, y: 30, size: 4, color: 'red' } },
                { className: 'Point', data: { x: 30, y: 40, size: 4, color: 'red' } },
              ],
              strokeWidth: 4,
              isClosed: true,
            },
          },
        ],
      ]),
      { x: 10, y: 20 },
      2,
      2
    );
    expect(shape).toEqual({
      points: [
        { className: 'Point', data: { x: 30, y: 40, size: 8, color: 'red' } },
        { className: 'Point', data: { x: 50, y: 60, size: 8, color: 'red' } },
      ],
      strokeWidth: 8,
      isClosed: true,
    });
  });

  it('preserves image crop and rotation while scaling its position and axes', () => {
    const shape = {};
    vi.stubGlobal('LC', { JSONToShape: (json: Record<string, unknown>) => json['data'] });
    resizeShapes(
      new Map([
        [
          shape,
          {
            className: 'Image',
            data: {
              x: 20,
              y: 30,
              scale: 2,
              scaleX: 1,
              scaleY: 1,
              rotation: Math.PI / 4,
              cropX: 5,
              cropY: 6,
              cropWidth: 40,
              cropHeight: 50,
            },
          },
        ],
      ]),
      { x: 10, y: 20 },
      2,
      2
    );
    expect(shape).toEqual({
      x: 30,
      y: 40,
      scale: 2,
      scaleX: 2,
      scaleY: 2,
      rotation: Math.PI / 4,
      cropX: 5,
      cropY: 6,
      cropWidth: 40,
      cropHeight: 50,
    });
  });
});
