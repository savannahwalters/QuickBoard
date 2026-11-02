import { Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { CanvasComponent } from '../ui/canvas/canvas/canvas.component';
import { ScriptComponent } from '../ui/script/script/script.component';
import { TimelineComponent } from '../ui/timeline/timeline/timeline.component';
import { AboutWindowComponent } from '../ui/dialogs/about-window/about-window.component';
import { SettingsComponent } from '../ui/dialogs/settings/settings.component';
import { ExportProgressComponent } from '../ui/export-progress/export-progress.component';
import { ExportSettingsComponent } from '../ui/export-settings/export-settings.component';
import { ThemeService } from '../services/theme.service';
import { SaveService } from '../services/save.service';
import { ExportIpcService } from '../services/export-ipc.service';
import { WindowScalingService } from '../services/window-scaling.service';
import { UndoRedoService } from '../services/undo-redo.service';
import { AndroidOpenFileService } from '../services/android-open-file.service';
import { WebToolbarComponent } from '../ui/web-toolbar/web-toolbar.component';
import { Capacitor } from '@capacitor/core';
import { AppShortcutsService, IosIntegrationService } from 'src/services';
import { KeyboardShortcutsComponent } from '../ui/dialogs/keyboard-shortcuts/keyboard-shortcuts.component';

@Component({
  selector: 'app-root',
  host: {
    '[class.dialog-mode]': 'dialogMode() !== null',
    '(document:keydown)': 'onKeyDown($event)',
    '[class.is-web]': 'useSafeArea',
  },
  imports: [
    CanvasComponent,
    ScriptComponent,
    TimelineComponent,
    ExportProgressComponent,
    ExportSettingsComponent,
    AboutWindowComponent,
    SettingsComponent,
    KeyboardShortcutsComponent,
    WebToolbarComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  protected readonly title = signal('QuickBoard');
  protected readonly isCanvasFullscreen = signal(false);
  protected readonly saveService = inject(SaveService);
  protected readonly dialogMode = signal<'about' | 'settings' | 'shortcuts' | null>(null);
  private readonly canvas = viewChild(CanvasComponent);
  private readonly el = inject(ElementRef);
  private readonly themeService = inject(ThemeService);
  private readonly windowScalingService = inject(WindowScalingService);
  protected readonly exportIpc = inject(ExportIpcService);
  protected readonly isElectron = !!window.quickboard;
  protected readonly isIos = Capacitor.getPlatform() === 'ios';
  protected readonly showWebToolbar = !this.isElectron && !this.isIos;
  protected readonly useSafeArea = !this.isElectron;
  private readonly undoRedo = inject(UndoRedoService);
  private readonly androidOpenFile = inject(AndroidOpenFileService);
  private readonly iosIntegration = inject(IosIntegrationService);
  private readonly shortcuts = inject(AppShortcutsService);
  private removeThemeListener?: () => void;
  private removeShortcutListener?: () => void | undefined;
  private removeWindowScalingListener?: () => void;
  private removeExportIpcListeners?: () => void;

  ngOnInit(): void {
    this.removeThemeListener = this.themeService.initTheme();

    this.iosIntegration.init(
      {
        flushCurrentBoardState: (force) => this.canvas()?.flushCurrentBoardState(force),
        prepareForProjectLoad: () => this.canvas()?.prepareForProjectLoad(),
      },
      (dialog) => this.dialogMode.set(dialog),
      () => this.title()
    );

    // Check if this window was opened as a dialog by the main process
    const params = new URLSearchParams(window.location.search);
    const dialog = params.get('dialog');
    if (dialog === 'about' || dialog === 'settings' || dialog === 'shortcuts') {
      this.dialogMode.set(dialog);
      return;
    }

    this.saveService.init();

    this.removeExportIpcListeners = this.exportIpc.init();

    // for shortcuts attached to appmenu options (working through electron side)
    if (window.quickboard?.onShortcut) {
      this.removeShortcutListener = window.quickboard.onShortcut((option: string) => {
        const target = document.activeElement as HTMLElement | null;
        if (
          target &&
          !target.closest('#editorjs') &&
          (target.matches('input, textarea, select') || target.isContentEditable)
        ) {
          document.execCommand(option);
          return;
        }
        switch (option) {
          case 'undo':
            this.undoRedo.triggerUndo();
            break;
          case 'redo':
            this.undoRedo.triggerRedo();
            break;
          default:
            break;
        }
      });
    }

    this.removeWindowScalingListener = this.windowScalingService.init(
      this.el.nativeElement as HTMLElement
    );

    this.androidOpenFile.init({
      prepareForProjectLoad: () => this.canvas()?.prepareForProjectLoad(),
    });
  }

  onResizeMouseDown(event: MouseEvent): void {
    this.windowScalingService.onResizeMouseDown(event, this.el.nativeElement as HTMLElement);
  }

  onResizeTouchStart(event: TouchEvent): void {
    this.windowScalingService.onResizeTouchStart(event, this.el.nativeElement as HTMLElement);
  }

  toggleCanvasFullscreen(): void {
    this.isCanvasFullscreen.update((fullscreen) => !fullscreen);
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }

  private isEditableTarget(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return false;
    }

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return true;
    }

    if (target.isContentEditable) {
      return true;
    }

    return !!target.closest('[contenteditable="true"]');
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    const key = event.key.toLowerCase();

    if (key === 'escape' && this.dialogMode() !== null) {
      event.preventDefault();
      this.closeDialog();
      return;
    }

    if (key === 'escape' && this.exportIpc.settingsVisible()) {
      event.preventDefault();
      this.exportIpc.onSettingsCancel();
      return;
    }

    if (this.dialogMode() !== null || this.exportIpc.settingsVisible()) {
      return;
    }

    if (this.isEditableTarget(event)) {
      const target = event.target as HTMLElement | null;
      // Allow global undo for EditorJS so its history interleaves perfectly with the canvas,
      // but let regular inputs/textareas use the browser's native undo.
      if (!target?.closest('#editorjs')) {
        return;
      }
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl || !['z', 'y'].includes(key)) {
        return;
      }
    }

    const canvas = this.canvas();
    if (canvas) this.shortcuts.handleKeyDown(event, canvas);
  }

  ngOnDestroy(): void {
    this.androidOpenFile.destroy();
    this.saveService.destroy();
    this.iosIntegration.destroy();
    this.removeThemeListener?.();
    this.removeShortcutListener?.();
    this.removeWindowScalingListener?.();
    this.removeExportIpcListeners?.();
  }

  protected closeDialog(): void {
    if (this.isElectron && new URLSearchParams(window.location.search).has('dialog')) {
      window.close();
      return;
    }
    this.dialogMode.set(null);
  }
}
