import { inject, Injectable } from '@angular/core';
import { AppStore } from 'src/data';
import { CanvasComponent, TimelineActions } from 'src/ui';
import { PlaybackService } from './playback.service';
import { UndoRedoService } from './undo-redo.service';
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

    switch (shortcut.id) {
      case 'playback':
        if (event.repeat) return;
        this.playback.togglePlayback();
        break;
      case 'undo':
        this.undoRedo.triggerUndo();
        break;
      case 'redo':
        this.undoRedo.triggerRedo();
        break;
      case 'add-board':
        this.store.addBoard();
        break;
      case 'add-audio-lane':
        this.store.addAudioLane();
        break;
      case 'duplicate-board': {
        const currentBoardId = this.store.currentBoardId();
        if (currentBoardId) this.actions.duplicateBoard(currentBoardId);
        break;
      }
      case 'delete-board': {
        const currentBoardId = this.store.currentBoardId();
        if (currentBoardId) this.actions.deleteBoard(currentBoardId);
        break;
      }
      case 'clear-canvas':
        canvas.requestClearCanvas();
        break;
      case 'timeline-zoom-in':
        this.timeZoom.zoomIn();
        break;
      case 'timeline-zoom-out':
        this.timeZoom.zoomOut();
        break;
      case 'seek-left':
      case 'seek-right':
        this.store.setCurrentTime(
          this.store.currentTime() + (shortcut.id === 'seek-right' ? 1 : -1)
        );
        this.playback.seek(this.store.currentTime());
        break;
      case 'previous-board':
      case 'next-board':
      case 'first-board':
      case 'last-board': {
        const boards = this.store.boards();
        if (!boards.length) return;
        const currentIndex = boards.findIndex((board) => board.id === this.store.currentBoardId());
        const direction = shortcut.id === 'next-board' ? 1 : -1;
        const index =
          shortcut.id === 'first-board'
            ? 0
            : shortcut.id === 'last-board'
            ? boards.length - 1
            : Math.max(0, Math.min(boards.length - 1, currentIndex + direction));
        this.store.setCurrentBoard(boards[index].id);
        this.playback.seek(this.playback.getTimeRanges()[index].startTime);
        break;
      }
      case 'move-board-left':
      case 'move-board-right': {
        const boards = this.store.boards();
        const currentIndex = boards.findIndex((board) => board.id === this.store.currentBoardId());
        if (currentIndex < 0) return;
        const direction = shortcut.id === 'move-board-right' ? 1 : -1;
        const nextIndex = Math.max(0, Math.min(boards.length - 1, currentIndex + direction));
        const ranges = this.playback.getTimeRanges();
        this.store.reorderBoards(currentIndex, nextIndex);
        this.playback.seek(
          direction === 1 ? ranges[currentIndex].endTime : ranges[nextIndex].startTime
        );
        this.store.setCurrentBoard(this.store.boards()[nextIndex].id);
        break;
      }
      case 'lengthen-board':
      case 'shorten-board': {
        const boards = this.store.boards();
        const currentIndex = boards.findIndex((board) => board.id === this.store.currentBoardId());
        if (currentIndex < 0) return;
        const range = this.playback.getTimeRanges()[currentIndex];
        const delta = shortcut.id === 'lengthen-board' ? 0.5 : -0.5;
        this.store.updateBoardDuration(
          boards[currentIndex].id,
          Math.max(0.5, range.endTime + delta)
        );
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }
}
