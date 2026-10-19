import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsService } from './app-settings.service';
import { appSettings } from 'src/settings-loader';
import { deepClone, SETTINGS_STORAGE_KEY } from 'src/settings-utils';
import defaults from '../electron/config/appsettings-defaults.json';

const originalSettings = deepClone(appSettings);
const originalBridge = window.quickboard;

describe('AppSettingsService', () => {
  let service: AppSettingsService;

  beforeEach(() => {
    localStorage.clear();
    window.quickboard = undefined;
    Object.assign(appSettings, deepClone(originalSettings));
    service = new AppSettingsService();
  });

  afterEach(() => {
    localStorage.clear();
    window.quickboard = originalBridge;
    Object.assign(appSettings, deepClone(originalSettings));
  });

  it('round-trips tool defaults through browser storage while retaining unrelated defaults', async () => {
    await service.saveAllSettings({
      tools: { eraser: { size: 64 }, brush: { size: 17, spacing: 90 }, bucketFill: { tolerance: 0 } },
    });
    Object.assign(appSettings, deepClone(originalSettings));
    await new AppSettingsService().loadCurrentSettings();
    expect(appSettings.tools.eraser.size).toBe(64);
    expect(appSettings.tools.brush).toEqual({ size: 17, spacing: 90 });
    expect(appSettings.tools.bucketFill.tolerance).toBe(0);
    expect(appSettings.tools.pencil).toEqual(originalSettings.tools.pencil);
  });

  it('hydrates disk settings over stale browser settings and fills missing tool defaults', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ tools: { pencil: { size: 9 } } }));
    window.quickboard = {
      getAppSettings: vi.fn().mockResolvedValue({ success: true, data: { tools: { pencil: { size: 42 } } } }),
    } as unknown as NonNullable<Window['quickboard']>;
    await service.loadCurrentSettings();
    expect(appSettings.tools.pencil.size).toBe(42);
    expect(appSettings.tools.brush).toEqual(originalSettings.tools.brush);
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).tools.pencil.size).toBe(42);
  });

  it('restores every tool default in the browser', async () => {
    await service.saveAllSettings({ tools: { eraser: { size: 80 }, bucketFill: { tolerance: 120 } } });
    await service.restoreDefaults();
    expect(appSettings.tools).toEqual(defaults.tools);
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).tools).toEqual(defaults.tools);
  });

  it('keeps muted default volume at zero after loading', async () => {
    await service.saveAllSettings({ audio: { defaultLaneCount: 1, defaultVolume: 0 } });
    await service.loadCurrentSettings();
    expect(service.getDefaultVolumePercent()).toBe(0);
  });
});
