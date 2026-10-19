import { ApplicationRef } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../data/store/app.store';
import { CanvasDataService } from '../services/canvas-data.service';
import { appSettings } from '../settings-loader';
import { deepClone } from '../settings-utils';
import { appConfig } from './app.config';
import type {} from '../ui/canvas/literally-canvas-interfaces';
import { getExportResolutions } from '../ui/export-settings/export-resolutions';

describe('Application settings initialization', () => {
  const originalSettings = deepClone(appSettings);
  const originalBridge = window.quickboard;
  let application: ApplicationRef | undefined;

  afterEach(() => {
    application?.destroy();
    application = undefined;
    localStorage.clear();
    window.quickboard = originalBridge;
    Object.assign(appSettings, deepClone(originalSettings));
  });

  it('waits for disk hydration and creates the already-imported store with hydrated defaults', async () => {
    localStorage.clear();
    let resolveSettings!: (settings: unknown) => void;
    const diskSettings = new Promise((resolve) => {
      resolveSettings = resolve;
    });
    window.quickboard = {
      getAppSettings: vi.fn().mockReturnValue(diskSettings),
    } as unknown as NonNullable<Window['quickboard']>;
    let initialized = false;
    const startup = createApplication({
      providers: [...appConfig.providers, { provide: CanvasDataService, useValue: {} }],
    }).then((app) => {
      application = app;
      initialized = true;
      return app;
    });
    await vi.waitFor(() => expect(window.quickboard?.getAppSettings).toHaveBeenCalledOnce());
    expect(initialized).toBe(false);

    resolveSettings({
      success: true,
      data: {
        canvas: { defaultBackgroundColor: '#123456' },
        board: { defaultDuration: 7, defaultFps: 30, width: 800, height: 600 },
        audio: { defaultLaneCount: 3, defaultVolume: 0 },
        onionSkin: { framesBack: 4 },
        export: {
          resolutions: [{ label: 'Custom', scale: 1, width: 800, height: 600 }],
        },
      },
    });
    const app = await startup;

    const store = app.injector.get(AppStore);
    expect(initialized).toBe(true);
    expect(store.boards()[0]).toMatchObject({ backgroundColor: '#123456', duration: 7 });
    expect(store.currentBoardId()).toBe(store.boards()[0].id);
    expect(store.fps()).toBe(30);
    expect(store.width()).toBe(800);
    expect(store.height()).toBe(600);
    expect(store.audioLaneCount()).toBe(3);
    expect(store.audioLaneMixers()[0].volume).toBe(0);
    expect(store.onionFramesBack()).toBe(4);
    expect(getExportResolutions()).toEqual([
      { label: 'Custom', scale: 1, width: 800, height: 600 },
    ]);
  });
});
