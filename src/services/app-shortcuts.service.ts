import { inject, Injectable } from '@angular/core';
import { AppStore } from 'src/data';
import { CanvasComponent } from 'src/ui';
import { PlaybackService } from 'src/services';
import { UndoRedoService } from 'src/services';
import { TimelineActions } from 'src/ui';
import { TimelineZoomService } from './timeline-zoom.service';
import { matchShortcut } from 'src/shared/shortcuts';

@Injectable({ providedIn: 'root' })
export class AppShortcutsService {
  private readonly store = inject(AppStore);
  private readonly playback = inject(PlaybackService);
  private readonly undoRedo = inject(UndoRedoService);
  private readonly actions = inject(TimelineActions);
  private readonly timeZoom = inject(TimelineZoomService);

  handleKeyDown(event: KeyboardEvent, canvas: CanvasComponent): void {
    const shortcut = matchShortcut(event);
    if (!shortcut || shortcut.group === 'Tools' || (window.quickboard && shortcut.menu)) return;
    if (shortcut.id === 'playback') {
      if (!event.repeat) {
        event.preventDefault();
        this.playback.togglePlayback();
      }
    } else if (shortcut.modifiers.includes('primary')) {
      this.onCtrlKeyShortcuts(event, canvas);
    } else if (shortcut.modifiers.includes('alt')) {
      event.preventDefault();
      this.onAltKeyShortcuts(event);
    } else {
      this.onNotCtrlKeyShortcuts(event);
    }
  }

  private onNotCtrlKeyShortcuts(event: KeyboardEvent) {
    const key = matchShortcut(event)?.id;
    const currentIndex = this.store
      .boards()
      .findIndex((board) => board.id === this.store.currentBoardId());
    const ranges = this.playback.getTimeRanges();

    if (!this.store.boards().length) return;
    switch (key) {
      case 'next-board': {
        const nextBoardIndex = Math.min(this.store.boards().length - 1, currentIndex + 1);
        const nextBoardID = this.store.boards()[nextBoardIndex].id;
        this.store.setCurrentBoard(nextBoardID);
        this.playback.seek(ranges[nextBoardIndex].startTime);
        break;
      }
      case 'previous-board': {
        const prevBoardIndex = Math.max(0, currentIndex - 1);
        const prevBoardID = this.store.boards()[prevBoardIndex].id;
        this.store.setCurrentBoard(prevBoardID);
        this.playback.seek(ranges[prevBoardIndex].startTime);
        break;
      }
      case 'move-board-right':
      case 'seek-right': {
        event.preventDefault();
        if (key === 'move-board-right') {
          const nextBoardIndex = Math.min(this.store.boards().length - 1, currentIndex + 1);
          this.store.reorderBoards(currentIndex, nextBoardIndex);
          this.playback.seek(ranges[currentIndex].endTime);
          this.store.setCurrentBoard(this.store.boards()[nextBoardIndex].id);
        } else {
          this.store.setCurrentTime(this.store.currentTime() + 1);
          this.playback.seek(this.store.currentTime());
        }
        break;
      }
      case 'move-board-left':
      case 'seek-left': {
        event.preventDefault();
        if (key === 'move-board-left') {
          const prevBoardIndex = Math.max(0, currentIndex - 1);
          this.store.reorderBoards(currentIndex, prevBoardIndex);
          this.playback.seek(ranges[prevBoardIndex].startTime);
          this.store.setCurrentBoard(this.store.boards()[prevBoardIndex].id);
        } else {
          this.store.setCurrentTime(this.store.currentTime() - 1);
          this.playback.seek(this.store.currentTime());
        }
        break;
      }
      case 'timeline-zoom-in': {
        this.timeZoom.zoomIn();
        break;
      }
      case 'timeline-zoom-out': {
        this.timeZoom.zoomOut();
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }

  private onCtrlKeyShortcuts(event: KeyboardEvent, canvas: CanvasComponent) {
    // actions with ctrl/cmd key
    const shortcut = matchShortcut(event);
    const key = shortcut?.id;
    const ranges = this.playback.getTimeRanges();

    switch (key) {
      case 'undo': {
        this.undoRedo.triggerUndo();
        break;
      }
      case 'redo': {
        this.undoRedo.triggerRedo();
        break;
      }
      case 'add-board':
      case 'add-audio-lane': {
        if (key === 'add-audio-lane') {
          this.store.addAudioLane();
        } else {
          this.store.addBoard();
        }
        break;
      }
      case 'duplicate-board': {
        const currentBoardId = this.store.currentBoardId();
        if (currentBoardId) {
          this.actions.duplicateBoard(currentBoardId);
        }
        break;
      }
      case 'delete-board':
      case 'clear-canvas': {
        if (key === 'clear-canvas') {
          canvas.requestClearCanvas();
        } else {
          const currentBoardId = this.store.currentBoardId();
          if (currentBoardId) {
            this.actions.deleteBoard(currentBoardId);
          }
        }
        break;
      }
      case 'save':
      case 'save-as': {
        if (key === 'save-as') {
          window.quickboard?.requestSaveAs();
        } else {
          window.quickboard?.requestSave();
        }
        break;
      }
      case 'load':
        window.quickboard?.loadIn();
        break;
      case 'export':
        window.quickboard?.requestExport();
        break;
      case 'last-board': {
        if (!this.store.boards().length) return;
        const lastBoard = this.store.boards()[this.store.boards().length - 1].id;
        this.store.setCurrentBoard(lastBoard);
        this.playback.seek(ranges[this.store.boards().length - 1].startTime);
        break;
      }
      case 'first-board': {
        if (!this.store.boards().length) return;
        const firstBoard = this.store.boards()[0].id;
        this.store.setCurrentBoard(firstBoard);
        this.playback.seek(ranges[0].startTime);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }

  private onAltKeyShortcuts(event: KeyboardEvent) {
    const key = matchShortcut(event)?.id;
    const currentIndex = this.store
      .boards()
      .findIndex((board) => board.id === this.store.currentBoardId());
    const ranges = this.playback.getTimeRanges();

    if (currentIndex < 0) return;
    if (key === 'lengthen-board') {
      this.store.updateBoardDuration(
        this.store.boards()[currentIndex]?.id,
        (ranges[currentIndex].endTime += 0.5)
      );
    } else if (key === 'shorten-board') {
      this.store.updateBoardDuration(
        this.store.boards()[currentIndex]?.id,
        Math.max(0.5, (ranges[currentIndex].endTime -= 0.5))
      );
    }
  }
}
