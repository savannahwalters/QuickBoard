import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../../data/store/app.store';
import { CanvasDataService } from '../../../services/canvas-data.service';
import { UndoRedoService, type UndoableCommand } from '../../../services/undo-redo.service';
import type { LCInstance } from '../literally-canvas-interfaces';
import { ObjectEraser } from '../tools/objecteraser';
import { CanvasUndoRedoService } from './canvas-undo-redo.service';

describe('object eraser shared history integration', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  function setup() {
    let boardId = 'drawing';
    const store = {
      currentBoardId: () => boardId,
      setCurrentBoard: vi.fn((id: string) => {
        boardId = id;
      }),
    };
    const record = vi.fn<(command: UndoableCommand) => void>();
    const setCanvasData = vi.fn();
    const persist = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AppStore, useValue: store },
        { provide: UndoRedoService, useValue: { record } },
        { provide: CanvasDataService, useValue: { setCanvasData } },
      ],
    });
    const history = TestBed.inject(CanvasUndoRedoService);
    const shape = {
      className: 'Image',
      getBoundingRect: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    };
    vi.stubGlobal('LC', {
      shapeToJSON: (shape: unknown) => shape,
      renderSnapshotToImage: () => ({
        width: 1,
        height: 1,
        getContext: () => ({
          getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
        }),
      }),
    });
    const undoStack: { do(): void; undo(): void }[] = [];
    const redoStack: typeof undoStack = [];
    const lc = {
      shapes: [shape],
      undoStack,
      redoStack,
      getSnapshot: () => ({ shapes: [...lc.shapes] }),
      repaintLayer: vi.fn(),
      execute: (action: (typeof undoStack)[number]) => {
        action.do();
        undoStack.push(action);
        redoStack.length = 0;
      },
      undo: vi.fn(() => {
        const action = undoStack.pop()!;
        action.undo();
        redoStack.push(action);
      }),
      redo: vi.fn(() => {
        const action = redoStack.pop()!;
        action.do();
        undoStack.push(action);
      }),
      trigger: () => history.onDrawingChange(lc, boardId, persist),
    } as unknown as LCInstance;
    history.markStrokeStart(lc);
    const eraser = new ObjectEraser(lc);
    eraser.begin(0, 0);
    eraser.end(0, 0);
    return { lc, store, record, setCanvasData, persist, shape };
  }

  it('records one global command and preserves LC undo/redo on the active board', () => {
    const { lc, record, persist, shape } = setup();
    expect(record).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledExactlyOnceWith('drawing', true, { deferPreviews: true });
    expect(lc.shapes).toEqual([]);
    const command = record.mock.calls[0][0];
    command.undo();
    expect(lc.shapes).toEqual([shape]);
    command.redo();
    expect(lc.shapes).toEqual([]);
  });

  it('restores snapshots when undoing or redoing from another board', () => {
    const { lc, store, record, setCanvasData, shape } = setup();
    const command = record.mock.calls[0][0];
    store.setCurrentBoard('other');
    command.undo();
    expect(setCanvasData).toHaveBeenLastCalledWith('drawing', { shapes: [shape] });
    expect(store.setCurrentBoard).toHaveBeenLastCalledWith('drawing');
    expect(lc.undo).not.toHaveBeenCalled();
    store.setCurrentBoard('other');
    command.redo();
    expect(setCanvasData).toHaveBeenLastCalledWith('drawing', { shapes: [] });
    expect(lc.redo).not.toHaveBeenCalled();
  });
});
