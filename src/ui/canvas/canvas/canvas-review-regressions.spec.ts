import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../../data/store/app.store';
import { CanvasDataService } from '../../../services/canvas-data.service';
import { UndoRedoService, type UndoableCommand } from '../../../services/undo-redo.service';
import type { LCInstance } from '../literally-canvas-interfaces';
import { CanvasUndoRedoService } from '../undo-redo/canvas-undo-redo.service';
import { captureSelection, SelectionAction } from '../tools/improved-select/selection-action';
import {
  readSelectionClipboard,
  setCopiedShapes,
} from '../tools/improved-select/selection-clipboard';
import { ObjectEraser } from '../tools/objecteraser';
import { PixelEraser } from '../tools/pixel-eraser';
import { CanvasComponent } from './canvas.component';

describe('selection command history', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setCopiedShapes([]);
  });

  function setup() {
    let boardId = 'drawing';
    const store = {
      currentBoardId: () => boardId,
      setCurrentBoard: (id: string) => {
        boardId = id;
      },
    };
    const record = vi.fn<(command: UndoableCommand) => void>();
    const setCanvasData = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AppStore, useValue: store },
        { provide: UndoRedoService, useValue: { record } },
        { provide: CanvasDataService, useValue: { setCanvasData } },
      ],
    });
    const history = TestBed.inject(CanvasUndoRedoService);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('LC', {
      JSONToShape: (snapshot: { className: string; data: Record<string, unknown> }) => ({
        className: snapshot.className,
        ...structuredClone(snapshot.data),
      }),
      shapeToJSON: (shape: Record<string, unknown>) => {
        const { className, ...data } = shape;
        return { className, data: structuredClone(data) };
      },
    });
    const shape = { className: 'Rectangle', x: 10, y: 20 };
    const lc = {
      shapes: [shape],
      undoStack: [],
      redoStack: [],
      getSnapshot: () => ({ shapes: lc.shapes.map((shape) => LC.shapeToJSON(shape)) }),
      repaintLayer: vi.fn(),
      execute: (action: { do(): void; undo(): void }) => {
        action.do();
        lc.undoStack.push(action);
      },
      trigger: () => history.onDrawingChange(lc, 'drawing', vi.fn()),
    } as unknown as LCInstance;
    const harness = {
      lc,
      currentBoardId: 'drawing',
      canvasUndoRedo: history,
      setTool: vi.fn(),
      getActiveSelectionTool: () => ({ selectShapes: vi.fn() }),
    };
    return { harness, history, shape, lc, record, setCanvasData, store };
  }

  it('does not let an older toBlob completion overwrite a newer copy', async () => {
    const callbacks: BlobCallback[] = [];
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn().mockResolvedValue(undefined) } });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public data: Record<string, Blob>) {}
      }
    );
    vi.stubGlobal('LC', {
      shapeToJSON: (shape: unknown) => shape,
      renderSnapshotToImage: () => ({
        toBlob: (callback: BlobCallback) => callbacks.push(callback),
      }),
    });
    const shape = { getBoundingRect: () => ({ x: 0, y: 0, width: 10, height: 10 }) };
    const harness = {
      lc: { getSnapshot: () => ({}) },
      getActiveSelectionTool: () => ({ getCopyShapes: () => [shape] }),
    };
    const older = Reflect.apply(CanvasComponent.prototype.copySelection, harness, []);
    const newer = Reflect.apply(CanvasComponent.prototype.copySelection, harness, []);
    const read = vi.fn().mockResolvedValue([]);
    Object.assign(navigator.clipboard, { read });
    const paste = readSelectionClipboard();
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    const newImage = new Blob(['new'], { type: 'image/png' });
    callbacks[1](newImage);
    await newer;
    await paste;
    expect(read).toHaveBeenCalledOnce();
    callbacks[0](new Blob(['old'], { type: 'image/png' }));
    await older;
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    expect(vi.mocked(navigator.clipboard.write).mock.calls[0][0]).toMatchObject([
      { data: { 'image/png': newImage } },
    ]);
  });

  it.each([
    { name: 'object', Eraser: ObjectEraser },
    { name: 'pixel', Eraser: PixelEraser },
  ])(
    'captures input-independent history after committing unfinished $name erasure',
    ({ Eraser }) => {
      const { history, lc, record, setCanvasData, store } = setup();
      const first = {
        className: 'Image',
        getBoundingRect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      };
      const second = {
        className: 'Image',
        getBoundingRect: () => ({ x: 50, y: 0, width: 10, height: 10 }),
      };
      Object.assign(lc, {
        shapes: [first, second],
        canvas: document.createElement('canvas'),
        setShapesInProgress: vi.fn(),
        getSnapshot: () => ({
          shapes: lc.shapes.map((shape) => ({ className: (shape as typeof first).className })),
        }),
      });
      const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
        this: HTMLCanvasElement
      ) {
        let context = contexts.get(this);
        if (!context) {
          let erased = false;
          context = {
            getImageData: () => ({
              data: new Uint8ClampedArray(10 * 10 * 4).fill(erased ? 0 : 255),
            }),
            save: vi.fn(),
            restore: vi.fn(),
            setTransform: vi.fn(),
            beginPath: vi.fn(),
            arc: vi.fn(),
            fill: () => {
              erased = true;
            },
          } as unknown as CanvasRenderingContext2D;
          contexts.set(this, context);
        }
        return context;
      });
      Object.assign(LC, {
        createShape: (className: string, args: Record<string, unknown>) => ({ className, ...args }),
        shapeToJSON: (shape: unknown) => shape,
        JSONToShape: (shape: unknown) => shape,
        renderSnapshotToImage: () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 10;
          return canvas;
        },
      });
      const beforeErase = vi.fn(() => history.markStrokeStart(lc));
      const tool = new Eraser(lc, beforeErase);
      tool.strokeWidth = 20;
      tool.begin(5, 5);
      tool.begin(55, 5);
      expect(beforeErase).toHaveBeenCalledTimes(2);
      expect(record).toHaveBeenCalledOnce();
      tool.end(55, 5);
      expect(record).toHaveBeenCalledTimes(2);
      store.setCurrentBoard('other');
      record.mock.calls[1][0].undo();
      expect(setCanvasData).toHaveBeenLastCalledWith('drawing', {
        shapes: [{ className: 'Image' }],
      });
      store.setCurrentBoard('other');
      record.mock.calls[1][0].redo();
      expect(setCanvasData).toHaveBeenLastCalledWith('drawing', { shapes: [] });
    }
  );

  it('records an entire multi-object paste with a fresh cross-board undo snapshot', async () => {
    const { harness, history, shape, lc, record, setCanvasData, store } = setup();
    history.markStrokeStart(lc);
    shape.x = 40;
    lc.execute({ do: () => undefined, undo: () => undefined });
    lc.trigger('drawingChange');
    setCopiedShapes([
      { className: 'Rectangle', data: { x: 100, y: 100 } },
      { className: 'Rectangle', data: { x: 200, y: 200 } },
    ]);
    await Reflect.apply(CanvasComponent.prototype.pasteSelection, harness, []);
    expect(lc.shapes).toHaveLength(3);
    expect(record).toHaveBeenCalledTimes(2);
    expect(harness.setTool).toHaveBeenCalledWith('select');
    store.setCurrentBoard('other');
    record.mock.calls[1][0].undo();
    expect(setCanvasData).toHaveBeenLastCalledWith('drawing', {
      shapes: [{ className: 'Rectangle', data: { x: 40, y: 20 } }],
    });
    store.setCurrentBoard('other');
    record.mock.calls[1][0].redo();
    expect(setCanvasData.mock.calls.at(-1)?.[1]['shapes']).toHaveLength(3);
  });

  it('captures deletion after a pending gesture commits, rather than reusing its pre-move snapshot', () => {
    const { harness, history, lc, shape, record, setCanvasData, store } = setup();
    history.markStrokeStart(lc);
    const selection = {
      deleteSelectedShapes: (beforeDelete: () => void) => {
        shape.x = 70;
        lc.execute({ do: () => undefined, undo: () => undefined });
        lc.trigger('drawingChange');
        beforeDelete();
        const before = captureSelection(lc, [shape], null);
        lc.shapes.length = 0;
        lc.execute(new SelectionAction(lc, before, captureSelection(lc, [], null)));
        lc.trigger('drawingChange');
        return true;
      },
    };
    Object.assign(harness, { getActiveSelectionTool: () => selection });
    expect(Reflect.apply(CanvasComponent.prototype.deleteSelection, harness, [])).toBe(true);
    store.setCurrentBoard('other');
    record.mock.calls[1][0].undo();
    expect(setCanvasData).toHaveBeenLastCalledWith('drawing', {
      shapes: [{ className: 'Rectangle', data: { x: 70, y: 20 } }],
    });
  });
});
