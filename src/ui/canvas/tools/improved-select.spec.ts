import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LCInstance, ShapeRegistry } from '../literally-canvas-interfaces';
import { ImprovedSelectShape } from './improved-select';
import { getSelectionBounds, getShapeBounds } from './improved-select/geometry';
import { registerImprovedSelectShapes } from './improved-select/register-shapes';
import { getSelectionRegion } from './improved-select/selection-state';

type Shape = Record<string, unknown> & {
  getBoundingRect(): { x: number; y: number; width: number; height: number };
};
type Definition = Record<string, (this: Shape, ...args: never[]) => unknown>;

describe('selection interactions', () => {
  const cleanups: (() => void)[] = [];
  let opaqueRegions: { x: number; y: number; width: number; height: number }[];

  beforeEach(() => {
    opaqueRegions = [{ x: 20, y: 30, width: 20, height: 30 }];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement
    ) {
      return {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        setTransform: vi.fn(),
        beginPath: vi.fn(),
        rect: vi.fn(),
        ellipse: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: vi.fn(),
        getImageData: (_x: number, _y: number, width: number, height: number) => {
          if (width === 1 && height === 1) {
            return { data: new Uint8ClampedArray([0, 0, 1, 255]) };
          }
          const data = new Uint8ClampedArray(width * height * 4);
          for (const region of opaqueRegions) {
            for (let y = region.y; y < Math.min(region.y + region.height, height); y += 1) {
              for (let x = region.x; x < Math.min(region.x + region.width, width); x += 1) {
                data[(y * width + x) * 4 + 3] = 255;
              }
            }
          }
          return { data };
        },
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,test'
    );
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setup() {
    const definitions = new Map<string, Definition>();
    const renderers = new Map<string, Parameters<ShapeRegistry['defineCanvasRenderer']>[1]>();
    const api = {
      defineShape: (name: string, definition: Definition) => definitions.set(name, definition),
      defineCanvasRenderer: (
        name: string,
        renderer: Parameters<ShapeRegistry['defineCanvasRenderer']>[1]
      ) =>
        renderers.set(name, renderer),
      createShape: (className: string, args: Record<string, unknown>): Shape => {
        const definition = definitions.get(className);
        const shape = Object.assign(Object.create(definition ?? null), { className }) as Shape;
        if (definition) {
          Reflect.apply(definition['constructor'], shape, [args]);
        } else {
          Object.assign(shape, args);
        }
        return shape;
      },
      shapeToJSON: (shape: Shape) => ({
        className: shape['className'],
        data:
          typeof shape['toJSON'] === 'function'
            ? (shape['toJSON'] as () => Record<string, unknown>).call(shape)
            : {
                x: shape['x'],
                y: shape['y'],
                width: shape['width'],
                height: shape['height'],
                strokeWidth: shape['strokeWidth'],
                rotation: shape['rotation'],
              },
      }),
      JSONToShape: (snapshot: { className: string; data: Record<string, unknown> }): unknown => {
        const fromJSON = definitions.get(snapshot.className)?.['fromJSON'];
        return fromJSON
          ? Reflect.apply(fromJSON, null, [snapshot.data])
          : api.createShape(snapshot.className, snapshot.data);
      },
      renderSnapshotToImage: vi.fn((_snapshot, options) => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(options.rect.width);
        canvas.height = Math.ceil(options.rect.height);
        return canvas;
      }),
    };
    vi.stubGlobal('LC', api);
    registerImprovedSelectShapes(api);
    definitions.set('Rectangle', {
      constructor(this: Shape, args: Record<string, unknown>) {
        Object.assign(this, args);
      },
      getBoundingRect(this: Shape) {
        return {
          x: (this['x'] as number) - (this['strokeWidth'] as number) / 2,
          y: (this['y'] as number) - (this['strokeWidth'] as number) / 2,
          width: (this['width'] as number) + (this['strokeWidth'] as number),
          height: (this['height'] as number) + (this['strokeWidth'] as number),
        };
      },
    });
    const handlers = new Map<string, Set<(data: unknown) => void>>();
    let overlays: Shape[] = [];
    const actions: { do(): void; undo(): void }[] = [];
    const lc = {
      canvas: document.createElement('canvas'),
      scale: 1,
      backingScale: 1,
      position: { x: 0, y: 0 },
      shapes: [],
      repaintLayer: vi.fn(),
      setShapesInProgress: (shapes: Shape[]) => {
        overlays = shapes;
      },
      on: (event: string, handler: (data: unknown) => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
        return () => {
          handlers.get(event)!.delete(handler);
        };
      },
      trigger: (event: string, data: unknown) => {
        [...(handlers.get(event) ?? [])].forEach((handler) => handler(data));
      },
      execute: (action: { do(): void; undo(): void }) => {
        actions.push(action);
        action.do();
      },
    } as unknown as LCInstance;
    const objectTool = new ImprovedSelectShape(lc);
    const activate = (tool: ImprovedSelectShape) => {
      lc.tool?.willBecomeInactive?.(lc);
      lc.tool = tool;
      tool.didBecomeActive(lc);
    };
    const complete = vi.fn(() => activate(objectTool));
    const regionTool = (mode: 'rectangle' | 'circle' | 'lasso' | 'polygon') => {
      const tool = new ImprovedSelectShape(lc, mode, complete);
      activate(tool);
      return tool;
    };
    const rectangle = (width = 100, height = 100) =>
      api.createShape('Rectangle', {
        x: 100,
        y: 100,
        width,
        height,
        strokeWidth: 2,
      });
    const click = (x: number, y: number) => {
      lc.trigger('lc-pointerdown', { x, y });
      lc.trigger('lc-pointerup', { x, y });
    };
    cleanups.push(() => lc.tool?.willBecomeInactive?.(lc));
    return {
      lc,
      api,
      objectTool,
      activate,
      regionTool,
      rectangle,
      click,
      complete,
      actions,
      renderers,
      overlays: () => overlays,
    };
  }

  it.each(['rectangle', 'circle'] as const)(
    '%s marquee updates live on Shift press/release and commits constrained bounds',
    (mode) => {
      const h = setup();
      h.lc.shapes.push(h.rectangle());
      h.regionTool(mode);
      h.lc.trigger('lc-pointerdown', { x: 90, y: 90 });
      h.lc.trigger('lc-pointerdrag', { x: 180, y: 140 });
      expect(h.overlays()[0]).toMatchObject({ end: { x: 180, y: 140 } });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
      expect(h.overlays()[0]).toMatchObject({ end: { x: 180, y: 180 } });
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
      expect(h.overlays()[0]).toMatchObject({ end: { x: 180, y: 140 } });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
      h.lc.trigger('lc-pointerup', { x: 190, y: 150 });
      expect(getSelectionRegion(h.lc)).toMatchObject({
        start: { x: 90, y: 90 }, end: { x: 190, y: 190 }, mode,
      });
      expect(h.complete).toHaveBeenCalledOnce();
    }
  );

  it.each(['rectangle', 'circle'] as const)(
    '%s marquee honors held Shift, reverse drags and release before pointer-up',
    (mode) => {
      const h = setup();
      h.lc.shapes.push(h.rectangle());
      h.regionTool(mode);
      h.lc.canvas.dispatchEvent(new MouseEvent('pointerdown', { shiftKey: true }));
      h.lc.trigger('lc-pointerdown', { x: 200, y: 200 });
      h.lc.trigger('lc-pointerdrag', { x: 100, y: 150 });
      expect(h.overlays()[0]).toMatchObject({ end: { x: 100, y: 100 } });
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
      h.lc.trigger('lc-pointerup', { x: 100, y: 150 });
      expect(getSelectionRegion(h.lc)).toMatchObject({ end: { x: 100, y: 150 } });
    }
  );

  it('does not constrain a lasso while Shift is held', () => {
    const h = setup();
    h.regionTool('lasso');
    h.lc.trigger('lc-pointerdown', { x: 90, y: 90 });
    h.lc.trigger('lc-pointerdrag', { x: 180, y: 140 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    expect(h.overlays()[0]).toMatchObject({ end: { x: 180, y: 140 } });
  });

  it('deletes only selected objects in one undoable step and clears the handles', () => {
    const h = setup();
    const first = h.rectangle();
    const untouched = h.rectangle(50, 50);
    const last = h.rectangle(80, 80);
    h.lc.shapes.push(first, untouched, last);
    h.activate(h.objectTool);
    h.objectTool.selectShapes([first, last]);
    expect(h.objectTool.deleteSelectedShapes()).toBe(true);
    expect(h.lc.shapes).toEqual([untouched]);
    expect(h.objectTool.getSelectedShapes()).toEqual([]);
    expect(h.overlays()).toEqual([]);
    expect(h.actions).toHaveLength(1);
    expect(h.objectTool.deleteSelectedShapes()).toBe(false);
    expect(h.actions).toHaveLength(1);
    h.actions[0].undo();
    h.lc.trigger('drawingChange', {});
    expect(h.lc.shapes).toEqual([first, untouched, last]);
    expect(h.objectTool.getSelectedShapes()).toEqual([first, last]);
    h.actions[0].do();
    h.lc.trigger('drawingChange', {});
    expect(h.lc.shapes).toEqual([untouched]);
    expect(h.overlays()).toEqual([]);
  });

  it('captures deletion history only after committing a pending move', () => {
    const h = setup();
    const shape = h.rectangle();
    h.lc.shapes.push(shape);
    h.activate(h.objectTool);
    h.objectTool.selectShapes([shape]);
    h.lc.trigger('lc-pointerdown', { x: 129, y: 144 });
    h.lc.trigger('lc-pointerdrag', { x: 139, y: 164 });
    const capture = vi.fn(() => {
      expect(h.actions).toHaveLength(1);
      expect(shape).toMatchObject({ x: 110, y: 120 });
      expect(h.lc.shapes).toEqual([shape]);
    });
    h.objectTool.deleteSelectedShapes(capture);
    expect(capture).toHaveBeenCalledOnce();
    expect(h.actions).toHaveLength(2);
  });

  it('applies a quick move even without an intermediate drag event', () => {
    const h = setup();
    const shape = h.rectangle();
    h.lc.shapes.push(shape);
    h.activate(h.objectTool);
    h.objectTool.selectShapes([shape]);
    h.lc.trigger('lc-pointerdown', { x: 129, y: 144 });
    h.lc.trigger('lc-pointerup', { x: 159, y: 154 });
    expect(shape).toMatchObject({ x: 130, y: 110 });
    expect(h.actions).toHaveLength(1);
    h.actions[0].undo();
    expect(shape).toMatchObject({ x: 100, y: 100 });
  });

  it('applies a quick corner resize without an intermediate drag event', () => {
    const h = setup();
    const shape = h.rectangle();
    h.lc.shapes.push(shape);
    h.activate(h.objectTool);
    h.objectTool.selectShapes([shape]);
    h.lc.trigger('lc-pointerdown', { x: 201, y: 201 });
    h.lc.trigger('lc-pointerup', { x: 303, y: 303 });
    expect(shape).toMatchObject({ width: 200, height: 200 });
    expect(h.actions).toHaveLength(1);
    h.actions[0].undo();
    expect(shape).toMatchObject({ width: 100, height: 100 });
  });

  it('latches uniform corner resizing when Shift is pressed after the drag begins', () => {
    const h = setup();
    const shape = h.rectangle();
    shape['rotation'] = Math.PI / 4;
    h.lc.shapes.push(shape);
    h.activate(h.objectTool);
    h.objectTool.selectShapes([shape]);
    const bounds = getSelectionBounds([shape]);
    h.lc.trigger('lc-pointerdown', { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    h.lc.trigger('lc-pointerdrag', {
      x: bounds.x + bounds.width * 1.5, y: bounds.y + bounds.height * 2,
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    h.lc.trigger('lc-pointerup', {
      x: bounds.x + bounds.width * 2, y: bounds.y + bounds.height * 3,
    });
    expect(shape['className']).toBe('Rectangle');
    expect(shape['width']).toBeCloseTo(shape['height'] as number);
    expect(shape['rotation']).toBe(Math.PI / 4);
  });

  it.each(['Rectangle', 'Ellipse', 'Image'])(
    'latches screen-space stretching of a rotated %s when Shift is released mid-drag',
    (className) => {
      const h = setup();
      const shape = className === 'Image'
        ? h.api.createShape('Image', {
            x: 100, y: 100,
            image: Object.assign(document.createElement('canvas'), { width: 100, height: 100 }),
            rotation: Math.PI / 4,
          })
        : h.api.createShape(className, {
            x: 100, y: 100, width: 100, height: 100, strokeWidth: 2, rotation: Math.PI / 4,
          });
      h.lc.shapes.push(shape);
      h.activate(h.objectTool);
      h.objectTool.selectShapes([shape]);
      const originalBounds = getSelectionBounds([shape]);
      const bounds = h.overlays()[0].getBoundingRect();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
      h.lc.trigger('lc-pointerdown', { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
      h.lc.trigger('lc-pointerdrag', {
        x: bounds.x + bounds.width * 1.5, y: bounds.y + bounds.height * 2,
      });
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
      h.lc.trigger('lc-pointerup', {
        x: bounds.x + bounds.width * 2, y: bounds.y + bounds.height * 3,
      });
      expect(shape['className']).toBe('Image');
      expect(shape['rotation']).toBe(0);
      const resized = getShapeBounds(shape)!;
      expect(resized.width).toBeCloseTo(originalBounds.width * 2);
      expect(resized.height).toBeCloseTo(originalBounds.height * 3);
    }
  );


  it.each(['rectangle', 'circle', 'polygon', 'lasso'] as const)(
    'deletes only the region selected with %s and restores it on undo',
    (mode) => {
      const h = setup();
      const shape = h.rectangle();
      const overlapping = h.rectangle();
      const untouched = h.rectangle();
      untouched['x'] = 400;
      h.lc.shapes.push(shape, untouched, overlapping);
      h.regionTool(mode);
      h.lc.trigger('lc-pointerdown', { x: 110, y: 110 });
      if (mode === 'polygon') {
        h.lc.trigger('lc-pointerup', { x: 110, y: 110 });
        h.click(150, 110);
        h.click(150, 190);
        h.click(110, 190);
        h.click(110, 110);
      } else if (mode === 'lasso') {
        h.lc.trigger('lc-pointerdrag', { x: 150, y: 110 });
        h.lc.trigger('lc-pointerdrag', { x: 150, y: 190 });
        h.lc.trigger('lc-pointerup', { x: 110, y: 190 });
      } else {
        h.lc.trigger('lc-pointerup', { x: 150, y: 190 });
      }
      expect(getSelectionRegion(h.lc)).not.toBeNull();
      const region = getSelectionRegion(h.lc);
      const contexts: CanvasRenderingContext2D[] = [];
      const getContext = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation()!;
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
        this: HTMLCanvasElement
      ) {
        const context = getContext.call(this, '2d') as CanvasRenderingContext2D;
        contexts.push(context);
        return context;
      });
      expect(h.objectTool.deleteSelectedShapes()).toBe(true);
      expect(h.lc.shapes).toHaveLength(3);
      expect(h.lc.shapes).not.toContain(shape);
      expect(h.lc.shapes[1]).toBe(untouched);
      expect(
        contexts.filter((ctx) => ctx.globalCompositeOperation === 'destination-out')
      ).toHaveLength(2);
      expect(h.lc.shapes[0]).toMatchObject({ className: 'Image' });
      expect(h.lc.shapes[2]).toMatchObject({ className: 'Image' });
      expect(getSelectionRegion(h.lc)).toBeNull();
      expect(h.objectTool.getSelectedShapes()).toEqual([]);
      expect(h.overlays()).toEqual([]);
      const fragments = [...h.lc.shapes];
      expect(h.actions).toHaveLength(1);
      h.actions[0].undo();
      h.lc.trigger('drawingChange', {});
      expect(h.lc.shapes).toEqual([shape, untouched, overlapping]);
      expect(getSelectionRegion(h.lc)).toBe(region);
      h.actions[0].do();
      h.lc.trigger('drawingChange', {});
      expect(h.lc.shapes).toEqual(fragments);
      expect(getSelectionRegion(h.lc)).toBeNull();
    }
  );

  it('copies clipped region fragments without changing the source scene or selection', () => {
    const h = setup();
    const shape = h.rectangle();
    h.lc.shapes.push(shape);
    h.regionTool('rectangle');
    h.lc.trigger('lc-pointerdown', { x: 110, y: 110 });
    h.lc.trigger('lc-pointerup', { x: 150, y: 180 });
    const region = getSelectionRegion(h.lc);
    const copied = h.objectTool.getCopyShapes();
    expect(copied).toHaveLength(1);
    expect(copied[0]['className']).toBe('Image');
    expect(getSelectionBounds(copied)).toEqual({ x: 119, y: 129, width: 20, height: 30 });
    expect(h.objectTool.getSelectedShapes()).toEqual([shape]);
    expect(getSelectionRegion(h.lc)).toBe(region);
    expect(h.lc.shapes).toEqual([shape]);
    expect(h.actions).toHaveLength(0);
  });

  it.each([
    [100, 100],
    [-100, 100],
    [100, -100],
    [-100, -100],
  ])('partially selects and splits rectangles drawn with dimensions %s, %s', (width, height) => {
    const h = setup();
    const shape = h.rectangle(width, height);
    h.lc.shapes.push(shape);
    const x = width < 0 ? 29 : 129;
    const y = height < 0 ? 44 : 144;
    h.regionTool('rectangle');
    h.lc.trigger('lc-pointerdown', { x: x - 15, y: y - 15 });
    h.lc.trigger('lc-pointerdrag', { x: x + 15, y: y + 15 });
    h.lc.trigger('lc-pointerup', { x: x + 15, y: y + 15 });
    expect(h.objectTool.getSelectedShapes()).toEqual([shape]);
    expect(h.overlays().map((overlay) => overlay['className'])).toEqual(['SelectionGroupOverlay']);
    expect(h.lc.shapes).toEqual([shape]);
    h.lc.trigger('lc-pointerdown', { x, y });
    h.lc.trigger('lc-pointerdrag', { x: x + 10, y: y + 10 });
    h.lc.trigger('lc-pointerup', { x: x + 10, y: y + 10 });
    expect(h.api.renderSnapshotToImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rect: getShapeBounds(shape) })
    );
    expect(h.lc.shapes).toHaveLength(2);
    expect(h.overlays().map((overlay) => overlay['className'])).toEqual(['SelectionGroupOverlay']);
    const fragment = h.objectTool.getSelectedShapes()[0] as Shape;
    expect(fragment.getBoundingRect()).toEqual({
      x: (width < 0 ? -1 : 99) + 30,
      y: (height < 0 ? -1 : 99) + 40,
      width: 20,
      height: 30,
    });
    const moved = fragment.getBoundingRect();
    h.actions[0].undo();
    h.lc.trigger('drawingChange', {});
    expect(h.lc.shapes).toEqual([shape]);
    expect(getSelectionRegion(h.lc)?.shapes).toEqual([shape]);
    h.actions[0].do();
    h.lc.trigger('drawingChange', {});
    expect(fragment.getBoundingRect()).toEqual(moved);
    expect(getSelectionRegion(h.lc)).toBeNull();
  });

  it('only closes polygon selection near the first point after at least three vertices', () => {
    const h = setup();
    h.lc.shapes.push(h.rectangle());
    h.regionTool('polygon');
    h.click(120, 120);
    h.click(121, 121);
    expect(h.complete).not.toHaveBeenCalled();
    h.click(180, 120);
    h.click(180, 180);
    h.click(181, 181);
    expect(h.complete).not.toHaveBeenCalled();
    expect(getSelectionRegion(h.lc)).toBeNull();
    h.click(122, 122);
    expect(h.complete).toHaveBeenCalledOnce();
    expect(h.lc.tool).toBe(h.objectTool);
    expect(h.overlays().map((overlay) => overlay['className'])).toEqual(['SelectionGroupOverlay']);
    expect(getSelectionRegion(h.lc)).toMatchObject({
      start: { x: 120, y: 120 },
      end: { x: 181, y: 181 },
      mode: 'polygon',
    });
  });

  it.each(['rectangle', 'circle', 'lasso'] as const)(
    'shows tightly bounded transform handles immediately after %s selection',
    (mode) => {
      const h = setup();
      const original = h.rectangle();
      h.lc.shapes.push(original);
      h.regionTool(mode);
      h.lc.trigger('lc-pointerdown', { x: 110, y: 110 });
      h.lc.trigger('lc-pointerdrag', { x: 180, y: 110 });
      h.lc.trigger('lc-pointerdrag', { x: 180, y: 180 });
      h.lc.trigger('lc-pointerup', { x: 180, y: 180 });
      expect(h.lc.tool).toBe(h.objectTool);
      expect(h.overlays()).toHaveLength(1);
      expect(h.overlays()[0]['className']).toBe('SelectionGroupOverlay');
      expect(h.overlays()[0].getBoundingRect()).toEqual({
        x: 119,
        y: 129,
        width: 20,
        height: 30,
      });
      expect(h.lc.shapes).toEqual([original]);
      expect(h.actions).toHaveLength(0);
    }
  );

  it('resizes region contents from their preview handles and undoes the split and resize together', () => {
    const h = setup();
    const original = h.rectangle();
    h.lc.shapes.push(original);
    h.regionTool('rectangle');
    h.lc.trigger('lc-pointerdown', { x: 110, y: 110 });
    h.lc.trigger('lc-pointerdrag', { x: 190, y: 190 });
    h.lc.trigger('lc-pointerup', { x: 190, y: 190 });
    h.lc.trigger('lc-pointerdown', { x: 139, y: 159 });
    expect(h.lc.shapes).toEqual([original]);
    h.lc.trigger('lc-pointerdrag', { x: 159, y: 189 });
    h.lc.trigger('lc-pointerup', { x: 159, y: 189 });
    expect(getSelectionBounds(h.objectTool.getSelectedShapes())).toEqual({
      x: 119,
      y: 129,
      width: 40,
      height: 60,
    });
    expect(h.actions).toHaveLength(1);
    h.actions[0].undo();
    h.lc.trigger('drawingChange', {});
    expect(h.lc.shapes).toEqual([original]);
    expect(h.overlays()[0]['className']).toBe('SelectionGroupOverlay');
    h.actions[0].do();
    h.lc.trigger('drawingChange', {});
    expect(getSelectionBounds(h.objectTool.getSelectedShapes()).width).toBe(40);
  });

  it('gives disconnected square-brush pieces separate cropped bounds after splitting', () => {
    const h = setup();
    opaqueRegions = [
      { x: 10, y: 30, width: 10, height: 10 },
      { x: 70, y: 30, width: 10, height: 10 },
    ];
    const stroke = h.rectangle();
    stroke['className'] = 'SquareLinePath';
    h.lc.shapes.push(stroke);
    h.regionTool('rectangle');
    h.lc.trigger('lc-pointerdown', { x: 100, y: 110 });
    h.lc.trigger('lc-pointerdrag', { x: 190, y: 180 });
    h.lc.trigger('lc-pointerup', { x: 190, y: 180 });
    h.lc.trigger('lc-pointerdown', { x: 145, y: 150 });
    h.lc.trigger('lc-pointerdrag', { x: 145, y: 200 });
    h.lc.trigger('lc-pointerup', { x: 145, y: 200 });
    expect(h.lc.shapes).toHaveLength(4);
    expect(h.lc.shapes.map((shape) => (shape as Shape).getBoundingRect())).toEqual([
      { x: 109, y: 129, width: 10, height: 10 },
      { x: 169, y: 129, width: 10, height: 10 },
      { x: 109, y: 179, width: 10, height: 10 },
      { x: 169, y: 179, width: 10, height: 10 },
    ]);
  });

  it('updates the polygon preview without adding drag vertices and resets when switched away', () => {
    const h = setup();
    const polygon = h.regionTool('polygon');
    h.click(50, 50);
    h.lc.trigger('lc-pointermove', { x: 200, y: 100 });
    expect(h.overlays()[0]['path']).toEqual([
      { x: 50, y: 50 },
      { x: 200, y: 100 },
    ]);
    h.lc.trigger('lc-pointerdown', { x: 200, y: 100 });
    h.lc.trigger('lc-pointerdrag', { x: 250, y: 150 });
    h.lc.trigger('lc-pointerup', { x: 250, y: 150 });
    expect(h.overlays()[0]['path']).toHaveLength(3);
    h.activate(h.objectTool);
    expect(h.overlays()).toEqual([]);
    h.activate(polygon);
    h.click(10, 10);
    expect(h.overlays()[0]['path']).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ]);
  });

  it('uses the release position even when the last pointer-drag event was throttled', () => {
    const h = setup();
    h.lc.shapes.push(h.rectangle());
    h.regionTool('rectangle');
    h.lc.trigger('lc-pointerdown', { x: 110, y: 110 });
    h.lc.trigger('lc-pointerdrag', { x: 130, y: 130 });
    h.lc.trigger('lc-pointerup', { x: 190, y: 190 });
    expect(getSelectionRegion(h.lc)).toMatchObject({
      start: { x: 110, y: 110 },
      end: { x: 190, y: 190 },
    });
    h.lc.trigger('lc-pointerdown', { x: 150, y: 150 });
    h.lc.trigger('lc-pointerdrag', { x: 160, y: 160 });
    h.lc.trigger('lc-pointerup', { x: 180, y: 180 });
    expect((h.objectTool.getSelectedShapes()[0] as Shape).getBoundingRect()).toMatchObject({
      x: 149,
      y: 159,
    });
  });

  it.each([1, 2])('resizes %s vector objects from a corner and supports undo/redo', (count) => {
    const h = setup();
    const shapes = Array.from({ length: count }, () => h.rectangle());
    h.lc.shapes.push(...shapes);
    h.activate(h.objectTool);
    h.objectTool.selectShapes(shapes);
    const before = getSelectionBounds(shapes);
    h.lc.trigger('lc-pointerdown', { x: 201, y: 201 });
    h.lc.trigger('lc-pointerdrag', { x: 303, y: 303 });
    h.lc.trigger('lc-pointerup', { x: 303, y: 303 });
    expect(shapes.map((shape) => shape['className'])).toEqual(Array(count).fill('Rectangle'));
    expect(getSelectionBounds(shapes)).toEqual({ x: 99, y: 99, width: 204, height: 204 });
    h.actions[0].undo();
    expect(getSelectionBounds(shapes)).toEqual(before);
    h.actions[0].do();
    expect(getSelectionBounds(shapes).width).toBe(204);
  });

  it('renders four corners and a rotate handle for vector and group selections', () => {
    const h = setup();
    const ctx = Object.assign(document.createElement('canvas').getContext('2d')!, {
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    });
    h.renderers.get('SelectionGroupOverlay')!(
      ctx,
      { shapes: [h.rectangle()] },
      vi.fn()
    );
    expect(ctx.arc).toHaveBeenCalledTimes(9);
    expect(ctx.fill).toHaveBeenCalledTimes(9);
  });

  it.each([1, 2])('rotates %s selected vector objects and supports undo/redo', (count) => {
    const h = setup();
    const shapes = Array.from({ length: count }, () => h.rectangle(100, 50));
    h.lc.shapes.push(...shapes);
    h.activate(h.objectTool);
    h.objectTool.selectShapes(shapes);
    h.lc.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 74 }));
    expect(h.lc.canvas.style.cursor).toBe('pointer');
    h.lc.trigger('lc-pointerdown', { x: 150, y: 74 });
    expect(h.lc.canvas.style.cursor).toBe('pointer');
    h.lc.trigger('lc-pointerdrag', { x: 201, y: 125 });
    h.lc.trigger('lc-pointerup', { x: 201, y: 125 });
    expect(shapes[0]['rotation']).toBeCloseTo(Math.PI / 2);
    expect(getSelectionBounds(shapes).width).toBeCloseTo(52);
    h.actions[0].undo();
    expect(getSelectionBounds(shapes).width).toBeCloseTo(102);
    h.actions[0].do();
    expect(getSelectionBounds(shapes).width).toBeCloseTo(52);
  });

  it('adds and removes images and strokes with Shift instead of consuming clicks as image movement', () => {
    const h = setup();
    const stroke = h.rectangle();
    const image = document.createElement('canvas');
    image.width = image.height = 102;
    const fill = h.api.createShape('Image', { x: 300, y: 99, image });
    h.lc.shapes.push(stroke, fill);
    h.activate(h.objectTool);
    h.click(329, 144);
    expect(h.objectTool.getSelectedShapes()).toEqual([fill]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    h.click(129, 144);
    expect(h.objectTool.getSelectedShapes()).toEqual([fill, stroke]);
    h.click(329, 144);
    expect(h.objectTool.getSelectedShapes()).toEqual([stroke]);
  });

  it('squashes only one axis with an edge midpoint and undoes the entire gesture', () => {
    const h = setup();
    const original = h.rectangle();
    h.lc.shapes.push(original);
    h.activate(h.objectTool);
    h.objectTool.selectShapes([original]);
    h.lc.trigger('lc-pointerdown', { x: 201, y: 150 });
    h.lc.trigger('lc-pointerdrag', { x: 303, y: 150 });
    h.lc.trigger('lc-pointerup', { x: 303, y: 150 });
    expect(original['width']).toBe(200);
    expect(original['height']).toBe(100);
    h.actions[0].undo();
    expect(original['width']).toBe(100);
    h.actions[0].do();
    expect(original['width']).toBe(200);
  });

  it('crops a mixed group with Shift-edge drag and restores vectors and order on undo', () => {
    const h = setup();
    const a = h.rectangle(),
      b = h.rectangle();
    h.lc.shapes.push(a, b);
    h.activate(h.objectTool);
    h.objectTool.selectShapes([a, b]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    h.lc.trigger('lc-pointerdown', { x: 201, y: 150 });
    h.lc.trigger('lc-pointerdrag', { x: 160, y: 150 });
    h.lc.trigger('lc-pointerup', { x: 160, y: 150 });
    expect(h.lc.shapes.map((shape) => (shape as Shape)['className'])).toEqual(['Image', 'Image']);
    h.actions[0].undo();
    h.lc.trigger('drawingChange', {});
    expect(h.lc.shapes).toEqual([a, b]);
    expect(a['className']).toBe('Rectangle');
    h.actions[0].do();
    expect(h.lc.shapes.map((shape) => (shape as Shape)['className'])).toEqual(['Image', 'Image']);
  });

  it('transforms future shapes through their renderer and restores their original prototype on undo', () => {
    const h = setup();
    h.api.defineShape('FutureShape', {
      constructor(this: Shape, data: Record<string, unknown>) {
        Object.assign(this, data);
      },
      getBoundingRect(this: Shape) {
        return { x: this['x'], y: this['y'], width: this['width'], height: this['height'] };
      },
    } as Definition);
    const future = h.api.createShape('FutureShape', { x: 100, y: 100, width: 100, height: 100 });
    const prototype = Object.getPrototypeOf(future);
    h.lc.shapes.push(future);
    h.activate(h.objectTool);
    h.objectTool.selectShapes([future]);
    h.lc.trigger('lc-pointerdown', { x: 200, y: 200 });
    h.lc.trigger('lc-pointerdrag', { x: 300, y: 300 });
    h.lc.trigger('lc-pointerup', { x: 300, y: 300 });
    expect(future['className']).toBe('Image');
    h.actions[0].undo();
    expect(future['className']).toBe('FutureShape');
    expect(Object.getPrototypeOf(future)).toBe(prototype);
    expect(future.getBoundingRect()).toEqual({ x: 100, y: 100, width: 100, height: 100 });
  });
});
