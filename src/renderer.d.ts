export {};

import type { CustomThemeId, ThemeId } from './shared/theme-types';

declare global {
  interface Window {
    quickboard?: {
      // for handling menu options in menu js file
      onRequestSave: (handler: (payload: { filePath: string }) => void) => () => void;
      onLoadData: (
        handler: (payload: { filePath: string; content: string; isBinary?: boolean }) => void,
      ) => () => void;
      sendSaveData: (payload: { filePath: string; data: string }) => void;
      sendSaveBinary: (payload: { filePath: string; data: Uint8Array }) => void;
      requestSave: () => void;
      requestSaveAs: () => void;
      loadIn: () => void;
      onThemeChanged: (
        handler: (theme: ThemeId) => void,
      ) => () => void;
      getThemeSource: () => Promise<ThemeId>;
      setCustomTheme: (theme: CustomThemeId | null) => void;
      onShortcut: (handler: (option: string) => void) => () => void;
      onImportImage: (handler: () => void) => () => void;
      pickImageFile: () => Promise<
        | { success: true; cancelled: true }
        | { success: true; name: string; type: string; data: string; cancelled?: false }
        | { success: false; message: string }
      >;
      onSaveResult: (
        handler: (payload: { filePath: string; success: boolean; message?: string }) => void,
      ) => () => void;
      openExternal: (url: string) => void;
      onRequestExport: (handler: (payload: { defaultDirPath: string }) => void) => () => void;
      requestExport: () => void;
      pickExportDir: () => Promise<string | null>;
      sendPngExportFrame: (payload: {
        dirPath: string;
        name: string;
        buffer: Uint8Array;
        index: number;
        total: number;
      }) => Promise<{ success: boolean; message?: string }>;
      sendVideoFile: (payload: {
        dirPath: string;
        name: string;
        buffer: Uint8Array;
      }) => Promise<{ success: boolean; message?: string }>;
      getAppSettings: () => Promise<{
        success: boolean;
        data?: Record<string, unknown>;
        message?: string;
      }>;
      saveAppSettings: (settings: Record<string, unknown>) => Promise<{
        success: boolean;
        message?: string;
      }>;
      restoreAppSettingsDefaults: () => Promise<{
        success: boolean;
        message?: string;
      }>;
      selectFolder: () => Promise<string | undefined>;
    };
  }
}
