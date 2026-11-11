import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FileSaver } from './file-saver.plugin';

interface NativeFilesPlugin {
  pickBoardFile(options: { directoryURL?: string }): Promise<{
    success: boolean;
    cancelled?: boolean;
    name?: string;
    data?: string;
    path?: string;
    message?: string;
  }>;
  saveBoardFile(options: {
    fileName: string;
    data: string;
    directoryURL?: string;
    forcePrompt?: boolean;
  }): Promise<{
    success: boolean;
    cancelled?: boolean;
    path?: string;
    message?: string;
  }>;
  selectFolder(options: { directoryURL?: string }): Promise<{
    success: boolean;
    cancelled?: boolean;
    path?: string;
    message?: string;
  }>;
}

const NativeFiles = registerPlugin<NativeFilesPlugin>('NativeFiles');

/**
 * Abstracts file save/load across all platforms:
 * - Electron: delegates to window.quickboard IPC (not used here, handled by SaveService)
 * - Android: uses ACTION_CREATE_DOCUMENT via FileSaver plugin (system file picker)
 * - iOS: uses @capacitor/share sheet (shows "Save to Files" reliably)
 * - Browser (web): uses blob URL download + <input type="file">
 */
/** iCloud folder path used as the default save/load location on iOS. */
export const IOS_DEFAULT_FOLDER = 'iCloud Drive/QuickBoard';

@Injectable({ providedIn: 'root' })
export class PlatformFileService {
  readonly isElectron = !!window.quickboard;
  readonly isNative = Capacitor.isNativePlatform();
  readonly isIos = Capacitor.getPlatform() === 'ios';

  private readonly iCloudQuickBoardFolder = IOS_DEFAULT_FOLDER;

  /**
   * Save a binary file.
   * - Native (Android): writes directly via ACTION_CREATE_DOCUMENT system picker. Returns true on confirmed save.
   * - Native (iOS): writes to a temp cache file and opens the OS share sheet. Returns false as we cannot confirm the save.
   * - Web: uses the File System Access API (showSaveFilePicker) when available,
   *   falling back to a blob download. Returns true on confirmed save.
   */
  async saveFile(
    data: Uint8Array,
    fileName: string,
    suggestedName?: string,
    forcePrompt = false,
  ): Promise<boolean> {
    if (this.isIos) {
      return this.saveNativeIpad(data, suggestedName || fileName, forcePrompt);
    } else if (this.isNative) {
      return this.saveNative(data, suggestedName || fileName);
    } else {
      return this.saveWeb(data, suggestedName || fileName);
    }
  }

  /**
   * Open a file picker and return the file contents as a Uint8Array.
   * On all platforms this uses a hidden <input type="file"> which works in
   * both the browser and Capacitor WebViews.
   */
  /**
   * Android only: check whether the app was launched by tapping a .sbd file.
   * Returns the file bytes and name, or null if no file intent is pending.
   */
  async checkAndroidOpenFile(): Promise<{ data: Uint8Array; name: string } | null> {
    if (Capacitor.getPlatform() !== 'android') return null;
    try {
      const result = await FileSaver.getOpenFileData();
      if (!result?.data) return null;
      const binary = atob(result.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { data: bytes, name: result.fileName || 'project.sbd' };
    } catch {
      return null;
    }
  }

  pickAndReadFile(accept: string): Promise<{ data: Uint8Array; name: string } | null> {
    if (this.isIos) {
      return this.pickIpadFile();
    }

    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);

      input.onchange = async () => {
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) {
          resolve(null);
          return;
        }
        try {
          const buffer = await file.arrayBuffer();
          resolve({ data: new Uint8Array(buffer), name: file.name });
        } catch (e) {
          console.error('Failed to read file:', e);
          resolve(null);
        }
      };

      input.oncancel = () => {
        document.body.removeChild(input);
        resolve(null);
      };

      input.click();
    });
  }

  async pickFolder(): Promise<string | undefined> {
    if (this.isIos) {
      try {
        const result = await NativeFiles.selectFolder({
          directoryURL: this.iCloudQuickBoardFolder,
        });
        if (result.success && result.path) {
          return result.path;
        }
      } catch (error) {
        console.warn('iPad folder picker failed.', error);
      }
      return undefined;
    }

    if (this.isElectron && window.quickboard?.selectFolder) {
      return window.quickboard.selectFolder();
    }

    return undefined;
  }

  async pickExportDir(): Promise<string | undefined> {
    if (this.isElectron && window.quickboard?.pickExportDir) {
      return (await window.quickboard.pickExportDir()) ?? undefined;
    }
    return this.pickFolder();
  }

  private async pickIpadFile(): Promise<{ data: Uint8Array; name: string } | null> {
    try {
      const result = await NativeFiles.pickBoardFile({
        directoryURL: this.iCloudQuickBoardFolder,
      });

      if (!result.success || result.cancelled || !result.data || !result.name) {
        return null;
      }

      const binary = atob(result.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return { data: bytes, name: result.name };
    } catch (error) {
      console.error('Failed to pick iPad file:', error);
      return null;
    }
  }

  private async saveNative(data: Uint8Array, fileName: string): Promise<boolean> {
    if (Capacitor.getPlatform() === 'android') {
      // ACTION_CREATE_DOCUMENT opens the system file picker — the user chooses
      // the folder and confirms the filename before the write happens.
      const base64 = this.toBase64(data);
      try {
        await FileSaver.saveFile({ data: base64, fileName });
        return true;
      } catch (e) {
        // Swallow silent cancels; re-throw real errors.
        if (e instanceof Error && e.message === 'cancelled') return false;
        if (
          typeof e === 'object' &&
          e !== null &&
          (e as { message?: string }).message === 'cancelled'
        )
          return false;
        throw e;
      }
    }

    // iOS: the share sheet reliably shows "Save to Files".
    const base64 = this.toBase64(data);
    const tmpPath = `tmp_${Date.now()}_${fileName}`;

    await Filesystem.writeFile({
      path: tmpPath,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    const { uri } = await Filesystem.getUri({
      path: tmpPath,
      directory: Directory.Cache,
    });

    try {
      await Share.share({
        title: fileName,
        url: uri,
        dialogTitle: `Save ${fileName}`,
      });
    } finally {
      await Filesystem.deleteFile({
        path: tmpPath,
        directory: Directory.Cache,
      }).catch((deleteError) => {
        console.warn(`Failed to cleanup temporary file: ${tmpPath}`, deleteError);
      });
    }

    return false; // Share sheet shown but can't confirm completion on iOS
  }

  private toBase64(data: Uint8Array): string {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  private async saveNativeIpad(
    data: Uint8Array,
    fileName: string,
    forcePrompt: boolean,
  ): Promise<boolean> {
    let binary = '';
    const chunkSize = 8192;
    for (let index = 0; index < data.length; index += chunkSize) {
      const chunk = data.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);

    try {
      const result = await NativeFiles.saveBoardFile({
        fileName,
        data: base64,
        directoryURL: this.iCloudQuickBoardFolder,
        forcePrompt,
      });

      if (!result.success && !result.cancelled) {
        throw new Error(result.message || 'Failed to save file to Apple Files.');
      }
      return result.success;
    } catch (error) {
      console.error('iPad Files save failed', error);
      throw error;
    }
  }


  private async saveWeb(data: Uint8Array, fileName: string): Promise<boolean> {
    // Attempt File System Access API for native "Save As"
    if ('showSaveFilePicker' in window) {
      try {
        const picker = window as unknown as {
          showSaveFilePicker: (opts: unknown) => Promise<{
            createWritable: () => Promise<{
              write: (d: Uint8Array) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }>;
        };
        const handle = await picker.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: 'QuickBoard Project',
              accept: { 'application/octet-stream': ['.sbd'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return true;
      } catch (e) {
        // User cancelled — no toast.
        if (e instanceof Error && e.name === 'AbortError') return false;
        console.warn('File System Access API failed, falling back to download', e);
      }
    }

    // Standard download fallback
    const blob = new Blob([data as unknown as ArrayBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }
}
