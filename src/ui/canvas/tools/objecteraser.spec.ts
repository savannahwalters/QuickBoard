import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LCInstance } from '../literally-canvas-interfaces';
import { ObjectEraser } from './objecteraser';

describe('object eraser', () => {
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
    vi.stubGlobal('LC', {
      shapeToJSON: (shape: unknown) => shape,
      JSONToShape: (snapshot: unknown) => snapshot,
      renderSnapshotToImage: render,
    });
    const shape = (className: string, pixels: number[][]) => ({
      className,
      pixels,
      getBoundingRect: () => ({ x: 0, y: 0, width: 20, height: 20 }),
    });
    const actions: { do(): void; undo(): void }[] = [];
    const lc = {
      shapes: [],
      execute: (action: { do(): void; undo(): void }) => {
        actions.push(action);
        action.do();
      },
      repaintLayer: vi.fn(),
      trigger: vi.fn(),
    } as unknown as LCInstance;
    const tool = new ObjectEraser(lc);
    tool.strokeWidth = 1;
    return { tool, lc, shape, actions, render };
  }

  it('uses shared pixel picking for fills, strokes and future renderers without blocking overlaps', () => {
    const { tool, lc, shape, actions } = setup();
    const first = shape('LinePath', [[5, 5]]);
    const fill = shape('Image', [[15, 15]]);
    const future = shape('PluginShape', [[5, 5]]);
    lc.shapes.push(first, fill, future);
    tool.didBecomeActive();
    tool.begin(5, 5);
    tool.end(5, 5);
    expect(lc.shapes).toEqual([fill]);
    expect(actions).toHaveLength(1);
    expect(lc.trigger).toHaveBeenCalledExactlyOnceWith('drawingChange', {});
    actions[0].undo();
    expect(lc.shapes).toEqual([first, fill, future]);
    actions[0].do();
    expect(lc.shapes).toEqual([fill]);
  });

  it('does not erase transparent image areas or record no-op strokes', () => {
    const { tool, lc, shape, actions } = setup();
    const fill = shape('Image', [[15, 15]]);
    lc.shapes.push(fill);
    tool.begin(5, 5);
    tool.continue(7, 7);
    tool.end(8, 8);
    expect(lc.shapes).toEqual([fill]);
    expect(actions).toHaveLength(0);
    expect(lc.trigger).not.toHaveBeenCalled();
  });

  it('records a drag as one action, including its release position', () => {
    const { tool, lc, shape, actions } = setup();
    lc.shapes.push(shape('LinePath', [[5, 5]]), shape('Image', [[15, 15]]));
    tool.begin(5, 5);
    tool.end(15, 15);
    expect(lc.shapes).toEqual([]);
    expect(actions).toHaveLength(1);
  });

  it('commits only once when switching away mid-stroke and invalidates cached pixels', () => {
    const { tool, lc, shape, actions, render } = setup();
    const fill = shape('Image', [[15, 15]]);
    lc.shapes.push(fill);
    tool.begin(5, 5);
    tool.willBecomeInactive();
    fill.pixels = [[5, 5]];
    tool.didBecomeActive();
    tool.begin(5, 5);
    tool.willBecomeInactive();
    tool.willBecomeInactive();
    expect(render).toHaveBeenCalledTimes(2);
    expect(lc.shapes).toEqual([]);
    expect(actions).toHaveLength(1);
  });

  it('preserves legacy masks so old erased content does not reappear', () => {
    const { tool, lc, shape, actions, render } = setup();
    const mask = shape('ErasedLinePath', [[5, 5]]);
    lc.shapes.push(mask);
    tool.begin(5, 5);
    tool.end(5, 5);
    expect(lc.shapes).toEqual([mask]);
    expect(render).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });
});
