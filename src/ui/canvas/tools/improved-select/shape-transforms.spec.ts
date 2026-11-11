import { afterEach, describe, expect, it, vi } from 'vitest';
import { resizeShapes, rotateShapes, translateShapes } from './shape-transforms';

describe('vector selection resizing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('moves mixed-style square brush points from immutable snapshots on every drag update', () => {
    const data = {
      points: [
        { className: 'Point', data: { x: 10, y: 20, size: 5, color: 'red' } },
        { className: 'Point', data: { x: 30, y: 40, size: 10, color: 'blue' } },
      ],
      spacing: 45,
    };
    vi.stubGlobal('LC', {
      JSONToShape: (snapshot: { data: typeof data }) => ({
        points: snapshot.data.points.map((point) => point.data),
        move({ xDiff, yDiff }: { xDiff: number; yDiff: number }) {
          this.points.forEach((point) => {
            point.x -= xDiff;
            point.y -= yDiff;
          });
        },
      }),
    });
    const shape: Record<string, unknown> = {};
    const states = new Map([[shape, { className: 'SquareLinePath', data }]]);
    translateShapes(states, 10, 0);
    translateShapes(states, 20, 0);
    expect(shape['points']).toEqual([
      { x: 30, y: 20, size: 5, color: 'red' },
      { x: 50, y: 40, size: 10, color: 'blue' },
    ]);
    expect(data.points[0].data.x).toBe(10);
    expect(data.points[1].data.x).toBe(30);
  });

  it('moves both stroke point sets and images together without using inconsistent LC move methods', () => {
    vi.stubGlobal('LC', { JSONToShape: (snapshot: Record<string, unknown>) => snapshot['data'] });
    const stroke = {},
      image = {};
    const states = new Map<Record<string, unknown>, Record<string, unknown>>([
      [
        stroke,
        {
          className: 'LinePath',
          data: {
            pointCoordinatePairs: [
              [10, 20],
              [30, 40],
            ],
            smoothedPointCoordinatePairs: [
              [10, 20],
              [30, 40],
            ],
            smooth: false,
          },
        },
      ],
      [image, { className: 'Image', data: { x: 5, y: 7 } }],
    ]);
    translateShapes(states, 50, 60);
    expect(stroke).toMatchObject({
      pointCoordinatePairs: [
        [60, 80],
        [80, 100],
      ],
      smoothedPointCoordinatePairs: [
        [60, 80],
        [80, 100],
      ],
    });
    expect(image).toEqual({ x: 55, y: 67 });
    translateShapes(states, 1, 2);
    expect(image).toEqual({ x: 6, y: 9 });
  });

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
