import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from 'src/data';
import { CanvasComponent, TimelineActions } from 'src/ui';
import { PlaybackService, UndoRedoService } from 'src/services';
import { AppShortcutsService } from './app-shortcuts.service';
import { TimelineZoomService } from './timeline-zoom.service';
import { shortcuts } from 'src/shared/shortcuts';

describe('app shortcut dispatch', () => {
  const addBoard = vi.fn();
  const addAudioLane = vi.fn();
  const triggerUndo = vi.fn();
  const togglePlayback = vi.fn();
  const boards = vi.fn<() => { id: string }[]>();
  const currentBoardId = vi.fn<() => string | null>();
  const getTimeRanges = vi.fn<() => { startTime: number; endTime: number }[]>();
  const setCurrentBoard = vi.fn();
  const updateBoardDuration = vi.fn();
  const seek = vi.fn();
  let service: AppShortcutsService;

  beforeEach(() => {
    boards.mockReturnValue([]);
    currentBoardId.mockReturnValue(null);
    getTimeRanges.mockReturnValue([]);
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    vi.stubGlobal('quickboard', {});
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AppStore,
          useValue: {
            boards,
            currentBoardId,
            addBoard,
            addAudioLane,
            setCurrentBoard,
            updateBoardDuration,
          },
        },
        { provide: PlaybackService, useValue: { getTimeRanges, togglePlayback, seek } },
        { provide: UndoRedoService, useValue: { triggerUndo } },
        { provide: TimelineActions, useValue: {} },
        { provide: TimelineZoomService, useValue: {} },
      ],
    });
    service = TestBed.inject(AppShortcutsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('leaves native shortcuts and unknown commands untouched', () => {
    for (const key of ['q', 'w', ',', 's', 'o', 'e', 'z', 'c', 'v', 'k']) {
      const event = new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true });
      service.handleKeyDown(event, {} as CanvasComponent);
      expect(event.defaultPrevented, key).toBe(false);
    }
    expect(triggerUndo).not.toHaveBeenCalled();
    expect(addBoard).not.toHaveBeenCalled();
  });

  it('executes a renderer-owned command exactly once', () => {
    const event = new KeyboardEvent('keydown', { key: 'n', metaKey: true, cancelable: true });
    service.handleKeyDown(event, {} as CanvasComponent);
    expect(event.defaultPrevented).toBe(true);
    expect(addBoard).toHaveBeenCalledTimes(1);
    expect(addAudioLane).not.toHaveBeenCalled();
  });

  it('uses the command identity for shifted bindings', () => {
    service.handleKeyDown(
      new KeyboardEvent('keydown', { key: 'N', metaKey: true, shiftKey: true }),
      {} as CanvasComponent
    );
    expect(addAudioLane).toHaveBeenCalledTimes(1);
    expect(addBoard).not.toHaveBeenCalled();
  });

  it('dispatches the same command after its registry modifiers change', () => {
    const shortcut = shortcuts.find((item) => item.id === 'add-board')!;
    const originalModifiers = shortcut.modifiers;
    try {
      shortcut.modifiers = [];
      const event = new KeyboardEvent('keydown', { key: 'n', cancelable: true });
      service.handleKeyDown(event, {} as CanvasComponent);
      expect(addBoard).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      shortcut.modifiers = originalModifiers;
    }
  });

  it('does not toggle playback on repeats or Option-Space', () => {
    for (const options of [{ repeat: true }, { altKey: true }]) {
      service.handleKeyDown(
        new KeyboardEvent('keydown', { key: ' ', ...options }),
        {} as CanvasComponent
      );
    }
    expect(togglePlayback).not.toHaveBeenCalled();
    service.handleKeyDown(new KeyboardEvent('keydown', { key: ' ' }), {} as CanvasComponent);
    expect(togglePlayback).toHaveBeenCalledTimes(1);
  });

  it('navigates to the first board using the registry binding', () => {
    boards.mockReturnValue([{ id: 'first' }, { id: 'second' }]);
    currentBoardId.mockReturnValue('second');
    getTimeRanges.mockReturnValue([
      { startTime: 0, endTime: 3 },
      { startTime: 3, endTime: 6 },
    ]);
    service.handleKeyDown(
      new KeyboardEvent('keydown', { key: 'Home', metaKey: true }),
      {} as CanvasComponent
    );
    expect(setCurrentBoard).toHaveBeenCalledWith('first');
    expect(seek).toHaveBeenCalledWith(0);
  });

  it('ignores board navigation safely when there are no boards', () => {
    const event = new KeyboardEvent('keydown', { key: ',', cancelable: true });
    service.handleKeyDown(event, {} as CanvasComponent);
    expect(setCurrentBoard).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('adjusts duration without mutating playback ranges', () => {
    const range = Object.freeze({ startTime: 0, endTime: 3 });
    boards.mockReturnValue([{ id: 'first' }]);
    currentBoardId.mockReturnValue('first');
    getTimeRanges.mockReturnValue([range]);
    service.handleKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true }),
      {} as CanvasComponent
    );
    expect(updateBoardDuration).toHaveBeenCalledWith('first', 3.5);
    expect(range.endTime).toBe(3);
  });
});
