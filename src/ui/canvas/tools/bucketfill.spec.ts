import { afterEach, describe, expect, it, vi } from 'vitest';
import { BucketFill } from './bucketfill';
import { LCInstance } from '../literally-canvas-interfaces';
import { registerImprovedSelectShapes } from './improved-select/register-shapes';

describe('bucket fill', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves ready fill images through the custom image serializer', () => {
    let definition!: {
      toJSON(this: Record<string, unknown>): Record<string, unknown>;
      fromJSON(data: Record<string, unknown>): unknown;
    };
    const api = {
      defineShape: (name: string, props: typeof definition) => {
        if (name === 'Image') definition = props;
      },
      defineCanvasRenderer: vi.fn(),
      createShape: vi.fn((_name, data) => data),
    };
    vi.stubGlobal('LC', api);
    registerImprovedSelectShapes(api);
    const image = Object.defineProperty(document.createElement('canvas'), 'src', {
      value: 'data:image/png;base64,fill',
    });
    image.width = 4;
    image.height = 3;
    const snapshot = definition.toJSON.call({ image, x: 0, y: 0, scale: 2 });

    expect(snapshot['imageObject']).toBe(image);
    definition.fromJSON(snapshot);
    expect(api.createShape).toHaveBeenLastCalledWith('Image', expect.objectContaining({ image }));

    definition.fromJSON(JSON.parse(JSON.stringify(snapshot)));
    expect(api.createShape).toHaveBeenLastCalledWith(
      'Image',
      expect.objectContaining({
        image: expect.any(HTMLImageElement),
      })
    );
  });

  it('does not discard a distinct fill color within the default tolerance', () => {
    const source = {
      width: 2,
      height: 2,
      getContext: () => ({
        getImageData: () => ({
          width: 2,
          height: 2,
          data: new Uint8ClampedArray(Array(4).fill([255, 255, 255, 255]).flat()),
        }),
      }),
    };
    const output = {
      width: 0,
      height: 0,
      getContext: () => ({ putImageData: vi.fn() }),
      toDataURL: () => 'data:image/png;base64,fill',
    };
    vi.spyOn(document, 'createElement').mockReturnValue(output as unknown as HTMLCanvasElement);
    vi.stubGlobal(
      'ImageData',
      class {
        data: Uint8ClampedArray;
        constructor(public width: number, public height: number) {
          this.data = new Uint8ClampedArray(width * height * 4);
        }
      }
    );
    const createShape = vi.fn((_type, data) => data);
    vi.stubGlobal('LC', { createShape });
    const saveShape = vi.fn();
    const lc = {
      getColor: () => '#f8f8f8',
      getImage: () => source,
      saveShape,
    } as unknown as LCInstance;

    new BucketFill().begin(0, 0, lc);

    expect(saveShape).toHaveBeenCalledOnce();
    expect(createShape).toHaveBeenCalledWith('Image', {
      x: 0,
      y: 0,
      scale: 2,
      image: output,
    });
    expect(output).toMatchObject({
      width: 2,
      height: 2,
      src: 'data:image/png;base64,fill',
    });
  });
});
