import { Injectable, inject } from '@angular/core';
import { AppStore } from '../../../data/store/app.store';
import { CanvasDataService } from '../../../services/canvas-data.service';
import { UndoRedoService } from '../../../services/undo-redo.service';
import { LCInstance } from '../literally-canvas-interfaces';

type PersistCanvasState = (
  boardId: string,
  includePreviews: boolean,
  options?: { deferPreviews?: boolean },
) => void;

@Injectable({ providedIn: 'root' })
export class CanvasUndoRedoService {
  private readonly store = inject(AppStore);
  private readonly undoRedo = inject(UndoRedoService);
  private readonly canvasDataService = inject(CanvasDataService);

  private suppressLcHistory = false;
  private lcUndoStackLength = 0;
  private snapshotBeforeStroke: Record<string, unknown> | null = null;

  public beginBoardLoad(): void {
    this.suppressLcHistory = true;
    this.lcUndoStackLength = 0;
  }

  public finishBoardLoad(lc: LCInstance): void {
    lc.undoStack.length = 0;
    lc.redoStack.length = 0;
    this.lcUndoStackLength = 0;
    this.suppressLcHistory = false;
    this.snapshotBeforeStroke = null;
  }

  public markStrokeStart(lc: LCInstance): void {
    if (!this.suppressLcHistory) {
      this.snapshotBeforeStroke = lc.getSnapshot();
    }
  }

  public onDrawingChange(
    lc: LCInstance,
    currentBoardId: string | null,
    persistCanvasState: PersistCanvasState,
  ): void {
    if (this.suppressLcHistory) {
      return;
    }

    const currentLen = lc.undoStack.length;
    if (currentLen <= this.lcUndoStackLength) {
      return;
    }

    this.lcUndoStackLength = currentLen;
    const boardIdAtRecord = currentBoardId;
    const beforeSnapshot = this.snapshotBeforeStroke;
    const afterSnapshot = lc.getSnapshot();
    this.snapshotBeforeStroke = null;

    this.undoRedo.record({
      undo: () => {
        if (!boardIdAtRecord) return;
        if (this.store.currentBoardId() !== boardIdAtRecord) {
          if (beforeSnapshot) {
            this.canvasDataService.setCanvasData(boardIdAtRecord, beforeSnapshot);
          }
          this.store.setCurrentBoard(boardIdAtRecord);
          return;
        }

        this.suppressLcHistory = true;
        if (lc.undoStack.length > 0) {
          this.lcUndoStackLength--;
          lc.undo();
        } else if (beforeSnapshot) {
          lc.loadSnapshot(beforeSnapshot);
          this.lcUndoStackLength = lc.undoStack.length;
        }
        this.suppressLcHistory = false;
      },
      redo: () => {
        if (!boardIdAtRecord) return;
        if (this.store.currentBoardId() !== boardIdAtRecord) {
          this.canvasDataService.setCanvasData(boardIdAtRecord, afterSnapshot);
          this.store.setCurrentBoard(boardIdAtRecord);
          return;
        }

        this.suppressLcHistory = true;
        if (lc.redoStack.length > 0) {
          this.lcUndoStackLength++;
          lc.redo();
        } else {
          lc.loadSnapshot(afterSnapshot);
          this.lcUndoStackLength = lc.undoStack.length;
        }
        this.suppressLcHistory = false;
      },
    });

    if (boardIdAtRecord) {
      persistCanvasState(boardIdAtRecord, true, { deferPreviews: true });
    }
  }

  public prepareClear(lc: LCInstance): Record<string, unknown> {
    const before = lc.getSnapshot();
    this.suppressLcHistory = true;

    lc.shapes = [];
    lc.backgroundShapes = [];
    lc.repaintLayer('main');
    lc.trigger('clear');

    this.lcUndoStackLength = lc.undoStack.length;
    this.suppressLcHistory = false;

    return before;
  }

  public recordClear(
    lc: LCInstance,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    boardIdAtClear: string | null,
  ): void {
    const beforeShapes = JSON.stringify((before as { shapes?: unknown }).shapes ?? []);
    const beforeBgShapes = JSON.stringify(
      (before as { backgroundShapes?: unknown }).backgroundShapes ?? [],
    );
    const afterShapes = JSON.stringify((after as { shapes?: unknown }).shapes ?? []);
    const afterBgShapes = JSON.stringify(
      (after as { backgroundShapes?: unknown }).backgroundShapes ?? [],
    );

    if (beforeShapes === afterShapes && beforeBgShapes === afterBgShapes) {
      return;
    }

    this.undoRedo.record({
      undo: () => {
        if (!boardIdAtClear) return;
        if (this.store.currentBoardId() !== boardIdAtClear) {
          this.canvasDataService.setCanvasData(boardIdAtClear, before);
          this.store.setCurrentBoard(boardIdAtClear);
          return;
        }
        this.suppressLcHistory = true;
        lc.loadSnapshot(before);
        this.lcUndoStackLength = lc.undoStack.length;
        this.suppressLcHistory = false;
      },
      redo: () => {
        if (!boardIdAtClear) return;
        if (this.store.currentBoardId() !== boardIdAtClear) {
          this.canvasDataService.setCanvasData(boardIdAtClear, after);
          this.store.setCurrentBoard(boardIdAtClear);
          return;
        }
        this.suppressLcHistory = true;
        lc.loadSnapshot(after);
        this.lcUndoStackLength = lc.undoStack.length;
        this.suppressLcHistory = false;
      },
    });
  }

  public undoStroke(lc: LCInstance): void {
    if (lc.undoStack.length === 0) {
      this.lcUndoStackLength = lc.undoStack.length;
      return;
    }

    this.suppressLcHistory = true;
    lc.undo();
    this.lcUndoStackLength = lc.undoStack.length;
    this.suppressLcHistory = false;
  }

  public redoStroke(lc: LCInstance): void {
    if (lc.redoStack.length === 0) {
      this.lcUndoStackLength = lc.undoStack.length;
      return;
    }

    this.suppressLcHistory = true;
    lc.redo();
    this.lcUndoStackLength = lc.undoStack.length;
    this.suppressLcHistory = false;
  }
}
