import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPastedShapes,
  setCopiedShapes,
  rememberCopiedImage,
  readSelectionClipboard,
} from './selection-clipboard';

describe('selection clipboard', () => {
  afterEach(() => {
    setCopiedShapes([]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  function clipboardImage(bytes: number[]) {
    return Object.assign(new Blob([new Uint8Array(bytes)], { type: 'image/png' }), {
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    });
  }

  function setupClipboard(image: Blob) {
    vi.stubGlobal('navigator', {
      clipboard: {
        read: vi.fn().mockResolvedValue([{ types: [image.type], getType: async () => image }]),
      },
    });
    const shape = { className: 'Rectangle', data: { x: 10, y: 20 } };
    const serialized = [shape];
    vi.stubGlobal('LC', {
      JSONToShape: (snapshot: typeof shape) => structuredClone(snapshot),
      shapeToJSON: (shape: unknown) => shape,
    });
    setCopiedShapes(serialized);
    return serialized;
  }

  it('prefers native shapes only when the system image matches the latest internal copy', async () => {
    const image = clipboardImage([1, 2, 3]);
    const copied = setupClipboard(clipboardImage([1, 2, 3]));
    rememberCopiedImage(copied, image);
    expect(await readSelectionClipboard()).toHaveProperty('shapes');
  });

  it('pastes newer external images instead of stale internal shapes, even with equal byte lengths', async () => {
    const external = clipboardImage([3, 2, 1]);
    const copied = setupClipboard(external);
    rememberCopiedImage(copied, clipboardImage([1, 2, 3]));
    expect(await readSelectionClipboard()).toEqual({ image: external });
  });

  it('uses the system image when the internal copy was never written to the system clipboard', async () => {
    const image = clipboardImage([1, 2, 3]);
    setupClipboard(image);
    expect(await readSelectionClipboard()).toEqual({ image });
  });

  it('does not paste stale objects when the readable clipboard has only text', async () => {
    setupClipboard(clipboardImage([1]));
    vi.mocked(navigator.clipboard.read).mockResolvedValue([]);
    expect(await readSelectionClipboard()).toBeNull();
  });

  it.each([true, false])(
    'keeps internal fallback when clipboard access is unavailable (denied: %s)',
    async (denied) => {
      setupClipboard(clipboardImage([1]));
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      if (denied)
        vi.mocked(navigator.clipboard.read).mockRejectedValue(new Error('Permission denied'));
      else vi.stubGlobal('navigator', {});
      expect(await readSelectionClipboard()).toHaveProperty('shapes');
    }
  );

  it('ignores completion of an older asynchronous copy after a newer selection is copied', async () => {
    const image = clipboardImage([1]);
    const older = setupClipboard(image);
    setCopiedShapes([{ className: 'Rectangle', data: { x: 20, y: 30 } }]);
    rememberCopiedImage(older, image);
    expect(await readSelectionClipboard()).toEqual({ image });
  });
});
