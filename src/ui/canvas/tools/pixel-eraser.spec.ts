import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LCInstance } from '../literally-canvas-interfaces';
import { bakeLegacyMasks, connectedImages, imageShape } from './improved-select/selection-raster';
import { PixelEraser } from './pixel-eraser';
import { CanvasComponent } from '../canvas/canvas.component';

describe('pixel eraser strokes', () => {
  let render: ReturnType<typeof vi.fn>;
  let opaque: boolean;

  beforeEach(() => {
    opaque = true;
    const rasters = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,test'
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement
    ) {
      const cached = rasters.get(this);
      if (cached) return cached;
      const width = this.width;
      const pixels = new Uint8ClampedArray(width * this.height * 4);
      let start = { x: 0, y: 0 };
      let end = start;
      let radius = 0;
      const erase = () => {
        const dx = end.x - start.x,
          dy = end.y - start.y;
        const length = dx * dx + dy * dy;
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < width; x++) {
            const t = length
              ? Math.max(
                  0,
                  Math.min(1, ((x + 0.5 - start.x) * dx + (y + 0.5 - start.y) * dy) / length)
                )
              : 0;
            if (Math.hypot(x + 0.5 - start.x - t * dx, y + 0.5 - start.y - t * dy) < radius) {
              pixels[(y * width + x) * 4 + 3] = 0;
            }
          }
        }
      };
      const context = {
        lineWidth: 0,
        save: vi.fn(),
        restore: vi.fn(),
        setTransform: vi.fn(),
        beginPath: vi.fn(),
        moveTo: (x: number, y: number) => {
          start = { x, y };
        },
        lineTo: (x: number, y: number) => {
          end = { x, y };
        },
        arc: (x: number, y: number, r: number) => {
          start = end = { x, y };
          radius = r;
        },
        fill: erase,
        stroke: () => {
          radius = context.lineWidth / 2;
          erase();
        },
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (data: { data: Uint8ClampedArray }) => pixels.set(data.data),
        getImageData: (left: number, top: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const index = ((y + top) * width + x + left) * 4;
              data.set(pixels.subarray(index, index + 4), (y * w + x) * 4);
            }
          }
          return { data };
        },
      } as unknown as CanvasRenderingContext2D;
      rasters.set(this, context);
      return context;
    });
    render = vi.fn((snapshot, options) => {
      const canvas = document.createElement('canvas');
      canvas.width = options.rect.width;
      canvas.height = options.rect.height;
      const context = canvas.getContext('2d')!;
      const data = context.createImageData(canvas.width, canvas.height);
      if (opaque) data.data.fill(255);
      for (const mask of snapshot.shapes.slice(1)) {
        const bounds = mask.getBoundingRect();
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (
              x + options.rect.x >= bounds.x &&
              x + options.rect.x < bounds.x + bounds.width &&
              y + options.rect.y >= bounds.y &&
              y + options.rect.y < bounds.y + bounds.height
            ) {
              data.data[(y * canvas.width + x) * 4 + 3] = 0;
            }
          }
        }
      }
      context.putImageData(data, 0, 0);
      return canvas;
    });
    vi.stubGlobal('LC', {
      shapeToJSON: (shape: unknown) => shape,
      JSONToShape: (shape: unknown) => shape,
      renderSnapshotToImage: render,
      createShape: (className: string, args: Record<string, unknown>) => ({
        className,
        ...args,
        getBoundingRect: () => ({
          x: args['x'],
          y: args['y'],
          width: args['cropWidth'],
          height: args['cropHeight'],
        }),
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setup(className = 'NewPluginShape') {
    const shape = {
      className,
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      getBoundingRect: () => ({ x: 0, y: 0, width: 100, height: 30 }),
    };
    const untouched = {
      className: 'LinePath',
      getBoundingRect: () => ({ x: 200, y: 200, width: 10, height: 10 }),
    };
    const actions: { do(): void; undo(): void }[] = [];
    const lc = {
      canvas: document.createElement('canvas'),
      setShapesInProgress: vi.fn(),
      shapes: [shape, untouched],
      backgroundShapes: [{ className: 'Background' }],
      execute: (action: { do(): void; undo(): void }) => {
        actions.push(action);
        action.do();
      },
      repaintLayer: vi.fn(),
      trigger: vi.fn(),
    } as unknown as LCInstance;
    const tool = new PixelEraser(lc);
    tool.strokeWidth = 10;
    return { lc, tool, shape, untouched, actions };
  }

  it.each([
    'Rectangle',
    'Ellipse',
    'LinePath',
    'SquareLinePath',
    'Image',
    'Polygon',
    'Text',
    'NewPluginShape',
  ])('renders %s and splits remaining pixels without changing untouched objects', (name) => {
    const { lc, tool, shape, untouched, actions } = setup(name);
    tool.begin(50, 0);
    expect(render).toHaveBeenCalledOnce();
    expect(lc.shapes[0]).toMatchObject({ className: 'Image' });
    tool.end(50, 30);
    expect(lc.shapes).toHaveLength(3);
    expect(lc.shapes.slice(0, 2)).toMatchObject([
      { className: 'Image', x: 0, cropWidth: 45, cropHeight: 30 },
      { className: 'Image', x: 55, cropWidth: 45, cropHeight: 30 },
    ]);
    expect(lc.shapes[2]).toBe(untouched);
    expect(render).toHaveBeenCalledOnce();
    expect(actions).toHaveLength(1);
    expect(lc.trigger).toHaveBeenCalledExactlyOnceWith('drawingChange', {});
    expect(lc.backgroundShapes).toEqual([{ className: 'Background' }]);
    actions[0].undo();
    expect(lc.shapes).toEqual([shape, untouched]);
    actions[0].do();
    expect(lc.shapes).toHaveLength(3);
  });

  it('records one undo step for multiple segments and includes the final release position', () => {
    const { tool, lc, actions } = setup();
    tool.begin(50, 0);
    tool.continue(50, 10);
    tool.continue(50, 20);
    tool.end(50, 30);
    expect(actions).toHaveLength(1);
    expect(lc.shapes).toHaveLength(3);
  });

  it('preserves legacy erased pixels while splitting and never converts the mask itself', () => {
    const { tool, lc, shape, untouched, actions } = setup();
    const mask = {
      className: 'ErasedLinePath',
      getBoundingRect: () => ({ x: 20, y: 0, width: 10, height: 30 }),
    };
    lc.shapes = [shape, mask, untouched];
    tool.begin(50, 0);
    tool.end(50, 30);
    expect(lc.shapes.slice(0, 3)).toMatchObject([
      { className: 'Image', x: 0, cropWidth: 20 },
      { className: 'Image', x: 30, cropWidth: 15 },
      { className: 'Image', x: 55, cropWidth: 45 },
    ]);
    expect(lc.shapes.slice(3)).toEqual([untouched]);
    actions[0].undo();
    expect(lc.shapes).toEqual([shape, mask, untouched]);
    actions[0].do();
    expect(lc.shapes.slice(3)).toEqual([untouched]);
  });

  it('does not remove legacy masks or change source objects while an affected image is loading', () => {
    const { shape } = setup('Image');
    const image = Object.assign(shape, { image: new Image() });
    const mask = {
      className: 'ErasedLinePath',
      getBoundingRect: () => ({ x: 20, y: 0, width: 10, height: 30 }),
    };
    const scene = [image, mask];
    expect(() => bakeLegacyMasks(scene)).toThrow('Wait for board images to load');
    expect(scene).toEqual([image, mask]);
    expect(image.className).toBe('Image');
    expect(render).not.toHaveBeenCalled();
  });

  it('does not convert transparent objects or record empty strokes', () => {
    opaque = false;
    const { tool, lc, shape, untouched, actions } = setup();
    tool.begin(50, 15);
    tool.end(50, 15);
    expect(lc.shapes).toEqual([shape, untouched]);
    expect(actions).toHaveLength(0);
    expect(lc.trigger).not.toHaveBeenCalled();
  });

  it.each(['release', 'switch', 'new-stroke'])(
    'cannot commit previews after legacy baking fails before %s',
    (completion) => {
      const { tool, lc, shape, untouched, actions } = setup();
      const loadingImage = {
        className: 'Image',
        image: new Image(),
        getBoundingRect: () => ({ x: 200, y: 200, width: 10, height: 10 }),
      };
      const mask = {
        className: 'ErasedLinePath',
        getBoundingRect: () => ({ x: 20, y: 0, width: 10, height: 30 }),
      };
      const scene = [shape, loadingImage, mask, untouched];
      lc.shapes = [...scene];
      expect(() => tool.begin(50, 15)).toThrow('Wait for board images to load');
      if (completion === 'release') tool.end(50, 15);
      else if (completion === 'switch') tool.willBecomeInactive();
      else {
        expect(() => tool.begin(50, 15)).toThrow('Wait for board images to load');
        tool.end(50, 15);
      }
      expect(lc.shapes).toEqual(scene);
      expect(actions).toHaveLength(0);
      expect(lc.trigger).not.toHaveBeenCalled();
    }
  );

  it('does not render objects outside the eraser bounds', () => {
    const { tool, actions } = setup();
    tool.begin(150, 100);
    tool.end(160, 100);
    expect(render).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('removes objects completely when no pixels remain', () => {
    const { tool, lc, untouched, actions } = setup();
    tool.strokeWidth = 200;
    tool.begin(50, 15);
    tool.end(50, 15);
    expect(lc.shapes).toEqual([untouched]);
    expect(actions).toHaveLength(1);
  });

  it('commits an unfinished stroke on tool switch, only once', () => {
    const { tool, actions } = setup();
    tool.begin(50, 15);
    tool.willBecomeInactive();
    tool.willBecomeInactive();
    expect(actions).toHaveLength(1);
  });

  it('finishes against the outgoing board before loading another scene, ignoring a late release', () => {
    const { tool, lc, actions, shape } = setup();
    lc.tool = tool;
    lc.isDragging = true;
    const destination = { className: 'DestinationShape' };
    const destinationSnapshot = { shapes: [destination] };
    const persist = vi.fn(() => {
      expect(harness.currentBoardId).toBe('source');
      expect(actions).toHaveLength(1);
      expect(lc.shapes[0]).not.toBe(shape);
    });
    const harness = {
      lc, currentBoardId: 'source', _canvasDirty: true,
      store: {
        boards: () => [{ id: 'destination', previewUrl: 'existing', backgroundColor: '#ffffff' }],
        width: () => 100, height: () => 30, updateBackgroundColor: vi.fn(),
      },
      canvasDataService: {
        setCanvasData: vi.fn(),
        getBoardCache: () => ({ shapes: [destination], backgroundShapes: [], snapshot: destinationSnapshot }),
      },
      canvasPersistence: {
        flushPendingPreviewRegeneration: vi.fn(),
        persistCurrentBoardData: persist,
        setLastLoadedCanvasData: vi.fn(),
      },
      canvasUndoRedo: { beginBoardLoad: vi.fn(), finishBoardLoad: vi.fn() },
      toolInstances: new Map(),
      backgroundColor: { set: vi.fn() },
      scheduleCanvasFit: vi.fn(),
      onionSkin: { updateCurrentBoardPreview: vi.fn(), pruneToCurrentAndNeighbors: vi.fn() },
    };
    Object.assign(lc, {
      getSnapshot: () => ({ shapes: [...lc.shapes] }),
      getColor: () => '#ffffff',
      setColor: vi.fn(),
      setImageSize: vi.fn(),
    });
    tool.begin(50, 0);
    Reflect.apply(Reflect.get(CanvasComponent.prototype, 'loadBoardData'), harness, ['destination']);
    expect(persist).toHaveBeenCalledOnce();
    expect(harness.currentBoardId).toBe('destination');
    expect(lc.shapes).toEqual([destination]);
    expect(lc.isDragging).toBe(false);
    tool.end(50, 30);
    expect(lc.shapes).toEqual([destination]);
    expect(actions).toHaveLength(1);
  });

  it('implements the activation lifecycle required by LiterallyCanvas', () => {
    const { tool, lc } = setup();
    tool.didBecomeActive();
    expect(lc.setShapesInProgress).toHaveBeenCalledWith([]);
    expect(lc.canvas.style.cursor).toBe('default');
  });

  it('cuts every overlapping object while keeping scene order', () => {
    const { tool, lc, shape, untouched } = setup();
    lc.shapes.push({ ...shape });
    tool.begin(50, 0);
    tool.end(50, 30);
    expect(lc.shapes).toHaveLength(5);
    expect(lc.shapes[2]).toBe(untouched);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('serializes current pixels while an eraser preview is changing', () => {
    const canvas = document.createElement('canvas');
    imageShape(canvas, { x: 0, y: 0, width: 10, height: 10 }, true);
    vi.mocked(canvas.toDataURL).mockReturnValue('data:image/png;base64,updated');
    expect(Reflect.get(canvas, 'src')).toBe('data:image/png;base64,updated');
  });

  it('encodes finalized connected fragments only once across repeated serializations', () => {
    const { shape } = setup();
    const source = LC.renderSnapshotToImage!(
      { shapes: [shape] },
      { rect: { x: 0, y: 0, width: 10, height: 10 }, scale: 1, includeWatermark: false }
    );
    const fragments = connectedImages(source, { x: 0, y: 0, width: 10, height: 10 });
    const image = fragments[0]['image'] as HTMLCanvasElement;
    const encode = vi.mocked(image.toDataURL);
    encode.mockClear();
    expect(Reflect.get(image, 'src')).toBe('data:image/png;base64,test');
    expect(Reflect.get(image, 'src')).toBe('data:image/png;base64,test');
    expect(Reflect.get(image, 'src')).toBe('data:image/png;base64,test');
    expect(encode).toHaveBeenCalledTimes(1);
  });
});
