import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPastedShapes,
  setCopiedShapes,
  writeCopiedImage,
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
        write: vi.fn().mockResolvedValue(undefined),
      },
    });
    const shape = { className: 'Rectangle', data: { x: 10, y: 20 } };
    const serialized = [shape];
    vi.stubGlobal('LC', {
      JSONToShape: (snapshot: typeof shape) => structuredClone(snapshot),
      shapeToJSON: (shape: unknown) => shape,
    });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public data: Record<string, Blob>) {}
      }
    );
    return setCopiedShapes(serialized);
  }

  it('prefers native shapes only when the system image matches the latest internal copy', async () => {
    const image = clipboardImage([1, 2, 3]);
    const copied = setupClipboard(clipboardImage([1, 2, 3]));
    await writeCopiedImage(copied, image);
    expect(await readSelectionClipboard()).toHaveProperty('shapes');
  });

  it('pastes newer external images instead of stale internal shapes, even with equal byte lengths', async () => {
    const external = clipboardImage([3, 2, 1]);
    const copied = setupClipboard(external);
    await writeCopiedImage(copied, clipboardImage([1, 2, 3]));
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
    await writeCopiedImage(older, image);
    expect(await readSelectionClipboard()).toEqual({ image });
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
  });

  it('does not write an older copy whose encoding finishes after the latest copy', async () => {
    const image = clipboardImage([1]);
    const older = setupClipboard(image);
    const newer = setCopiedShapes([]);
    await writeCopiedImage(newer, image);
    await writeCopiedImage(older, clipboardImage([2]));
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
  });

  it('serializes in-flight writes so a newer copy always finishes last', async () => {
    const older = setupClipboard(clipboardImage([1]));
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    vi.mocked(navigator.clipboard.write).mockReturnValueOnce(pending);
    const first = writeCopiedImage(older, clipboardImage([1]));
    await vi.waitFor(() => expect(navigator.clipboard.write).toHaveBeenCalledTimes(1));
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    const newer = setCopiedShapes([]);
    const second = writeCopiedImage(newer, clipboardImage([2]));
    await Promise.resolve();
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    complete();
    await Promise.all([first, second]);
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(2);
  });

  it('continues processing the latest copy after an earlier clipboard write fails', async () => {
    const first = setupClipboard(clipboardImage([1]));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(navigator.clipboard.write).mockRejectedValueOnce(new Error('Denied'));
    await writeCopiedImage(first, clipboardImage([1]));
    const newer = setCopiedShapes([]);
    await writeCopiedImage(newer, clipboardImage([2]));
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it.each(['text', 'image'])(
    'waits for encoding and native writing before pasting over old %s',
    async (oldContent) => {
      const image = clipboardImage([1, 2]);
      const generation = setupClipboard(image);
      if (oldContent === 'text') vi.mocked(navigator.clipboard.read).mockResolvedValue([]);
      let encode!: (blob: Blob) => void;
      let finishWrite!: () => void;
      const encoding = new Promise<Blob>((resolve) => {
        encode = resolve;
      });
      const writing = new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
      vi.mocked(navigator.clipboard.write).mockReturnValue(writing);
      const copy = writeCopiedImage(generation, encoding);
      const paste = readSelectionClipboard();
      await Promise.resolve();
      expect(navigator.clipboard.read).not.toHaveBeenCalled();
      encode(image);
      await vi.waitFor(() => expect(navigator.clipboard.write).toHaveBeenCalledOnce());
      expect(navigator.clipboard.read).not.toHaveBeenCalled();
      vi.mocked(navigator.clipboard.read).mockResolvedValue([
        { types: ['image/png'], getType: async () => image, presentationStyle: 'unspecified' },
      ]);
      finishWrite();
      await copy;
      expect(await paste).toHaveProperty('shapes');
    }
  );

  it('waits for a replacement copy that starts while paste is waiting', async () => {
    const image = clipboardImage([1]);
    const generation = setupClipboard(image);
    let encode!: (blob: Blob | null) => void;
    const older = writeCopiedImage(
      generation,
      new Promise((resolve) => {
        encode = resolve;
      })
    );
    const paste = readSelectionClipboard();
    const newerGeneration = setCopiedShapes([]);
    let encodeNew!: (blob: Blob | null) => void;
    const newer = writeCopiedImage(
      newerGeneration,
      new Promise((resolve) => {
        encodeNew = resolve;
      })
    );
    encode(image);
    await older;
    expect(navigator.clipboard.read).not.toHaveBeenCalled();
    encodeNew(image);
    await newer;
    expect(await paste).toEqual({ shapes: [] });
  });

  it.each(['null', 'rejected'])('unblocks paste when encoding fails: %s', async (failure) => {
    const image = clipboardImage([1]);
    const generation = setupClipboard(image);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const encoding =
      failure === 'null' ? Promise.resolve(null) : Promise.reject(new Error('Encoding failed'));
    await writeCopiedImage(generation, encoding);
    expect(await readSelectionClipboard()).toEqual({ image });
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
    expect(failure === 'null' ? console.error : console.warn).toHaveBeenCalledOnce();
  });
});
