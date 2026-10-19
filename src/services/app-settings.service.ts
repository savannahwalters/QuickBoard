import { Injectable } from '@angular/core';
import defaultSettings from '@econfig/appsettings.json';
import { appSettings } from 'src/settings-loader';
import {
  SETTINGS_STORAGE_KEY,
  deepClone,
  deepMerge,
  isRecord,
  readStoredSettings,
} from 'src/settings-utils';

export interface AppSettings {
  // Legacy root keys still used by parts of the app.
  initialDir: string;
  autosave: boolean;
  autosaveDuration: number;
  saving: {
    initialDir: string;
    autosave: boolean;
    autosaveDuration: number;
    savedToast: boolean;
    initialSave: boolean;
  };
  audio: {
    defaultLaneCount: number;
    defaultVolume: number;
  };
  theme: {
    systemLightTheme: string;
    systemDarkTheme: string;
  };
  canvas: {
    defaultStrokeColor: string;
    defaultFillColor: string;
    defaultBackgroundColor: string;
    defaultTool: string;
    zoomKeepOn?: boolean;
    zoomClickStep?: number;
    showClearCanvasWarning: boolean;
  };
  timeline: {
    zoom: {
      minZoom: number;
      maxZoom: number;
      defaultZoom: number;
      zoomStep: number;
    };
  };
  boil: {
    variations: number;
    holdFrames: number;
    amount: number;
    boilNewFrames: boolean;
  };
  export?: {
    defaultFormat: 'png' | 'video' | 'pdf';
    defaultResolutionIndex: number;
  };
  onionSkin?: {
    framesBack: number;
    framesForward: number;
    prevColor: string;
    nextColor: string;
  };
  tools?: {
    pencil?: { size?: number };
    brush?: { size?: number; spacing?: number };
    eraser?: { size?: number };
    rectangle?: { size?: number };
    circle?: { size?: number };
    polygon?: { size?: number };
    bucketFill?: { tolerance?: number };
  };
}

@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  private getRuntimeSettings(): Record<string, unknown> {
    return appSettings as unknown as Record<string, unknown>;
  }

  private getDefaultSettings(): Record<string, unknown> {
    return deepClone(defaultSettings) as Record<string, unknown>;
  }

  private writeStoredSettings(settings: Record<string, unknown>): void {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('Failed to write settings to local storage:', err);
    }
  }

  private applyRuntimeSettings(next: Record<string, unknown>): void {
    const runtime = this.getRuntimeSettings();
    for (const key of Object.keys(runtime)) {
      delete runtime[key];
    }
    Object.assign(runtime, next);
  }

  private readSettingsPayload(result: unknown): Record<string, unknown> | null {
    if (!isRecord(result)) {
      return null;
    }

    const hasStatus = typeof result['success'] === 'boolean';
    if (hasStatus && result['success'] === false) {
      return null;
    }

    if ('data' in result && isRecord(result['data'])) {
      return result['data'];
    }

    if (!('data' in result)) {
      return result;
    }

    return null;
  }

  /**
   * Load current app settings from defaults + local storage + disk (if available)
   */
  async loadCurrentSettings(): Promise<Partial<AppSettings>> {
    const merged = this.getDefaultSettings();
    deepMerge(merged, readStoredSettings());

    try {
      if (window.quickboard?.getAppSettings) {
        const result = await window.quickboard.getAppSettings();
        const diskSettings = this.readSettingsPayload(result);
        if (diskSettings) {
          deepMerge(merged, diskSettings);
        }
      }
    } catch (err) {
      console.error('Failed to load settings from IPC, using local fallback:', err);
    }

    this.applyRuntimeSettings(merged);
    this.writeStoredSettings(merged);
    return merged as Partial<AppSettings>;
  }

  /**
   * Get a specific setting value by path
   */
  getSetting<T>(path: string): T {
    try {
      const keys = path.split('.');
      let current: unknown = this.getRuntimeSettings();
      for (const key of keys) {
        if (typeof current === 'object' && current !== null) {
          current = (current as Record<string, unknown>)[key];
        } else {
          current = undefined;
        }
      }
      return current as T;
    } catch (err) {
      console.error('Error getting setting:', err);
      return undefined as T;
    }
  }

  /**
   * Save all settings immediately and keep runtime/local storage in sync
   */
  async saveAllSettings(settings: Partial<AppSettings>): Promise<void> {
    const merged = this.getDefaultSettings();
    deepMerge(merged, deepClone(this.getRuntimeSettings()));
    deepMerge(merged, settings as unknown as Record<string, unknown>);

    this.applyRuntimeSettings(merged);
    this.writeStoredSettings(merged);

    try {
      if (!window.quickboard?.saveAppSettings) {
        return;
      }

      const result = await window.quickboard.saveAppSettings(merged);
      if (isRecord(result) && result.success === false) {
        console.error('IPC settings save failed:', result.message ?? 'Unknown error');
      }
    } catch (err) {
      console.error('Error saving settings to disk:', err);
    }
  }

  /**
   * Restore all settings from appsettings-defaults.json
   */
  async restoreDefaults(): Promise<void> {
    try {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch (err) {
      console.error('Failed to clear stored settings:', err);
    }

    if (window.quickboard?.restoreAppSettingsDefaults) {
      const result = await window.quickboard.restoreAppSettingsDefaults();
      if (isRecord(result) && result.success === false) {
        throw new Error(String(result.message ?? 'Failed to restore defaults'));
      }
      await this.loadCurrentSettings();
      return;
    }

    const defaults = this.getDefaultSettings();
    this.applyRuntimeSettings(defaults);
    this.writeStoredSettings(defaults);
  }

  /**
   * Get the autosave duration in seconds (converted from ms in settings)
   */
  getAutosaveDurationSeconds(): number {
    try {
      const settings = appSettings as Partial<AppSettings> | undefined;
      return Math.round((settings?.saving?.autosaveDuration || 300000) / 1000);
    } catch {
      return 300;
    }
  }

  /**
   * Get the default volume as percentage (0-100)
   */
  getDefaultVolumePercent(): number {
    try {
      const settings = appSettings as Partial<AppSettings> | undefined;
      return (settings?.audio?.defaultVolume ?? 1) * 100;
    } catch {
      return 100;
    }
  }
}
