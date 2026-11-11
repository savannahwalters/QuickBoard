import { Injectable, Injector, effect, inject, type EffectRef } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AppStore } from 'src/data';
import { appSettings } from 'src/settings-loader';
import { SbdService } from '../app/app.sbd.service';
import { ExportIpcService } from './export-ipc.service';
import { NativeToolbarService, type ThemeId } from './native-toolbar.service';
import { PlatformFileService } from './platform-file.service';
import { SaveService } from './save.service';
import { ThemeService } from './theme.service';
import { UndoRedoService } from './undo-redo.service';

export interface IosCanvasDelegate {
  flushCurrentBoardState(force?: boolean): void;
  prepareForProjectLoad(): void;
  requestImageImport(): void;
}

type IosDialog = 'about' | 'settings' | null;

@Injectable({
  providedIn: 'root',
})
export class IosIntegrationService {
  private readonly sbd = inject(SbdService);
  private readonly themeService = inject(ThemeService);
  private readonly exportIpc = inject(ExportIpcService);
  private readonly undoRedo = inject(UndoRedoService);
  private readonly nativeToolbar = inject(NativeToolbarService);
  private readonly platformFile = inject(PlatformFileService);
  private readonly saveService = inject(SaveService);
  private readonly store = inject(AppStore);
  private readonly injector = inject(Injector);
  private settings = appSettings;

  public readonly isIos = Capacitor.getPlatform() === 'ios';
  private iosAutosaveTimer: ReturnType<typeof setInterval> | null = null;
  private iosSaveInProgress = false;
  private iosHasActiveDocument = false;
  private iosInitialSavePrompted = false;
  private iosInitialSaveEffectRef?: EffectRef;
  private iosMenuEffectRef?: EffectRef;
  private removeNativeMenuListener?: () => void;
  private canvasDelegate?: IosCanvasDelegate;
  private onOpenDialog?: (dialog: IosDialog) => void;

  init(
    delegate: IosCanvasDelegate,
    onOpenDialog: (dialog: IosDialog) => void,
    titleSignal: () => string
  ): void {
    if (!this.isIos) return;

    this.canvasDelegate = delegate;
    this.onOpenDialog = onOpenDialog;

    void this.nativeToolbar
      .onMenuAction((actionId) => {
        void this.handleNativeMenuAction(actionId);
      })
      .then((removeListener) => {
        this.removeNativeMenuListener = removeListener;
      });

    this.initIosSaveFlow();

    this.iosMenuEffectRef?.destroy();
    this.iosMenuEffectRef = effect(
      () => {
        this.nativeToolbar.setTitle(titleSignal());
        this.nativeToolbar.configureMenu(this.themeService.currentTheme() as ThemeId);
      },
      { injector: this.injector }
    );
  }

  destroy(): void {
    if (!this.isIos) return;

    this.removeNativeMenuListener?.();
    this.iosInitialSaveEffectRef?.destroy();
    this.iosMenuEffectRef?.destroy();
    if (this.iosAutosaveTimer) {
      clearInterval(this.iosAutosaveTimer);
      this.iosAutosaveTimer = null;
    }
  }

  private getIosSavingSettings(): {
    autosave: boolean;
    autosaveDurationMs: number;
    initialSave: boolean;
  } {
    const saving = this.settings.saving;
    const resolvedAutosave = saving?.autosave ?? this.settings.autosave ?? true;
    const resolvedAutosaveDuration =
      saving?.autosaveDuration ?? this.settings.autosaveDuration ?? 300_000;
    const autosaveDurationMs =
      typeof resolvedAutosaveDuration === 'number' && resolvedAutosaveDuration > 0
        ? resolvedAutosaveDuration
        : 300_000;

    return {
      autosave: resolvedAutosave,
      autosaveDurationMs,
      initialSave: saving?.initialSave ?? true,
    };
  }

  private initIosSaveFlow(): void {
    this.iosInitialSavePrompted = false;

    this.iosInitialSaveEffectRef?.destroy();
    this.iosInitialSaveEffectRef = effect(
      () => {
        const hasUndoHistory = this.undoRedo.canUndo();

        if (!hasUndoHistory) {
          this.iosInitialSavePrompted = false;
          return;
        }

        if (!this.getIosSavingSettings().initialSave) {
          return;
        }

        if (this.iosInitialSavePrompted || this.iosHasActiveDocument || this.iosSaveInProgress) {
          return;
        }

        this.iosInitialSavePrompted = true;
        void this.triggerIosSave(false);
      },
      { injector: this.injector }
    );

    const { autosave, autosaveDurationMs } = this.getIosSavingSettings();
    if (autosave) {
      this.iosAutosaveTimer = setInterval(() => {
        if (!this.iosHasActiveDocument || this.iosSaveInProgress) {
          return;
        }
        void this.triggerIosSave(false, false, true);
      }, autosaveDurationMs);
    }
  }

  private async handleNativeMenuAction(actionId: string): Promise<void> {
    switch (actionId) {
      case 'app.about':
        this.openMobileDialog('about');
        return;
      case 'app.settings':
        this.openMobileDialog('settings');
        return;
      case 'file.save':
        await this.triggerIosSave(false);
        return;
      case 'file.saveAs':
        await this.triggerIosSave(true);
        return;
      case 'file.load':
        await this.triggerIosLoad();
        return;
      case 'file.export':
        this.triggerIosExport();
        break;
      case 'file.importImage':
        this.canvasDelegate?.requestImageImport();
        return;
      case 'edit.undo':
        this.undoRedo.triggerUndo();
        return;
      case 'edit.redo':
        this.undoRedo.triggerRedo();
        return;
      default:
        if (actionId.startsWith('theme.')) {
          const [, theme] = actionId.split('.') as [string, ThemeId];
          this.themeService.applyTheme(theme);
        }
    }
  }

  private openMobileDialog(dialog: 'about' | 'settings'): void {
    this.exportIpc.onSettingsCancel();
    this.onOpenDialog?.(dialog);
  }

  public async triggerIosSave(
    promptForName: boolean,
    showToast = true,
    isAutosave = false
  ): Promise<boolean> {
    if (this.iosSaveInProgress) {
      return false;
    }

    this.iosSaveInProgress = true;

    try {
      const isModernWeb = !window.quickboard && 'showSaveFilePicker' in window;

      // Note: this logic from app.ts was slightly ambiguous about !this.isIos
      // but since it's in triggerIosSave we keep it for now as is.
      if (promptForName && !isModernWeb && !this.isIos) {
        const newName = window.prompt(
          'Enter file name without extension:',
          this.exportIpc.defaultPrefix() || 'project'
        );
        if (newName) {
          this.exportIpc.setProjectName(newName);
        } else {
          return false;
        }
      }

      this.canvasDelegate?.flushCurrentBoardState(true);

      const zipData = await this.sbd.buildSbdZip();
      const fileName = `${this.exportIpc.defaultPrefix() || 'project'}.sbd`;
      const saved = await this.platformFile.saveFile(zipData, fileName, undefined, promptForName);

      if (!saved) {
        if (!isAutosave) {
          this.iosInitialSavePrompted = false;
        }
        return false;
      }

      this.iosHasActiveDocument = true;

      if (showToast) {
        this.saveService.saveStatus.set('Saved!');
        setTimeout(() => {
          if (this.saveService.saveStatus() === 'Saved!') {
            this.saveService.saveStatus.set(null);
          }
        }, 2000);
      }

      return true;
    } catch (error) {
      console.error('Save failed from native iPad menu', error);
      window.alert(
        `Failed to save file: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    } finally {
      this.iosSaveInProgress = false;
    }
  }

  private async triggerIosLoad(): Promise<void> {
    try {
      this.canvasDelegate?.prepareForProjectLoad();
      const result = await this.platformFile.pickAndReadFile('.sbd');
      if (!result) {
        return;
      }

      await this.sbd.loadSbdZip(result.data);
      this.undoRedo.clear();

      const stem = result.name.replace(/\.[^.]+$/, '');
      if (stem) {
        this.exportIpc.setProjectName(stem);
      }

      this.iosHasActiveDocument = true;
      this.iosInitialSavePrompted = true;
    } catch (error) {
      console.error('Load failed from native iPad menu', error);
      window.alert(
        `Failed to load file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private triggerIosExport(): void {
    this.onOpenDialog?.(null); // Close any open dialogs
    this.exportIpc.settingsBoardCount.set(this.store.boards().length);
    this.exportIpc.settingsVisible.set(true);
  }
}
