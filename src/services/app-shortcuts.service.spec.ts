import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from 'src/data';
import { CanvasComponent, TimelineActions } from 'src/ui';
import { PlaybackService, UndoRedoService } from 'src/services';
import { AppShortcutsService } from './app-shortcuts.service';
import { TimelineZoomService } from './timeline-zoom.service';

describe('app shortcut dispatch', () => {
  const addBoard = vi.fn();
  const addAudioLane = vi.fn();
  const triggerUndo = vi.fn();
  const togglePlayback = vi.fn();
  let service: AppShortcutsService;

  beforeEach(() => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    vi.stubGlobal('quickboard', {});
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AppStore,
          useValue: { boards: () => [], currentBoardId: () => null, addBoard, addAudioLane },
        },
        { provide: PlaybackService, useValue: { getTimeRanges: () => [], togglePlayback } },
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
});
