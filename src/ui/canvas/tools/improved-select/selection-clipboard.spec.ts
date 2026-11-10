import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPastedShapes, setCopiedShapes } from './selection-clipboard';

describe('selection clipboard', () => {
  afterEach(() => {
    setCopiedShapes([]);
    vi.unstubAllGlobals();
  });

  it('offsets stroke geometry and transformed images using the shared adapters', () => {
    const copied = [
      {
        className: 'LinePath',
        data: {
          pointCoordinatePairs: [
            [1, 2],
            [3, 4],
          ],
          smoothedPointCoordinatePairs: [[2, 3]],
        },
      },
      {
        className: 'Image',
        data: { x: 10, y: 30, rotation: 1, scaleX: 2, cropX: 5, cropWidth: 40 },
      },
    ];
    vi.stubGlobal('LC', {
      JSONToShape: (snapshot: { className: string; data: Record<string, unknown> }) => ({
        className: snapshot.className,
        ...structuredClone(snapshot.data),
      }),
      shapeToJSON: (shape: Record<string, unknown>) => {
        const { className, ...data } = shape;
        return { className, data };
      },
    });
    setCopiedShapes(copied);
    const pasted = createPastedShapes();
    expect(pasted[0]).toMatchObject({
      pointCoordinatePairs: [
        [21, 22],
        [23, 24],
      ],
      smoothedPointCoordinatePairs: [[22, 23]],
    });
    expect(pasted[1]).toMatchObject({
      x: 30,
      y: 50,
      rotation: 1,
      scaleX: 2,
      cropX: 5,
      cropWidth: 40,
    });
    expect(copied[0].data.pointCoordinatePairs).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(createPastedShapes()).toEqual(pasted);
    expect(createPastedShapes()[0]).not.toBe(pasted[0]);
  });

  it('leaves an empty internal clipboard available for the system-image fallback', () => {
    expect(createPastedShapes()).toEqual([]);
  });
});
