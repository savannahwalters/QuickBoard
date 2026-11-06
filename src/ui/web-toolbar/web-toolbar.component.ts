import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  output,
  signal,
} from '@angular/core';
import { SbdService } from '../../app/app.sbd.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { ExportIpcService } from '../../services/export-ipc.service';
import { ThemeService } from '../../services/theme.service';
import { SaveService } from '../../services/save.service';
import { PlatformFileService } from '../../services/platform-file.service';

@Component({
  standalone: true,
  selector: 'app-web-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './web-toolbar.component.html',
  styleUrl: './web-toolbar.component.css',
})
export class WebToolbarComponent {
  private readonly sbd = inject(SbdService);
  private readonly undoRedo = inject(UndoRedoService);
  private readonly exportIpc = inject(ExportIpcService);
  private readonly themeService = inject(ThemeService);
  private readonly saveService = inject(SaveService);
  private readonly platformFile = inject(PlatformFileService);

  readonly activeMenu = signal<string | null>(null);
  readonly openMobileAbout = output<void>();
  readonly isElectron = !!window.quickboard;
  readonly currentTheme = this.themeService.currentTheme;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.menu-dropdown-container')) {
      this.closeMenu();
    }
  }

  toggleMenu(menu: string, event: MouseEvent): void {
    event.stopPropagation();
    this.activeMenu.set(this.activeMenu() === menu ? null : menu);
  }

  closeMenu(): void {
    this.activeMenu.set(null);
  }

  async triggerMobileSaveAs(): Promise<void> {
    const isModernWeb = !window.quickboard && 'showSaveFilePicker' in window;

    if (isModernWeb) {
      // Modern browsers handle the naming/location via the native Save As dialog already
      await this.triggerMobileSave();
      return;
    }

    const newName = window.prompt(
      'Enter file name without extension:',
      this.exportIpc.defaultPrefix() || 'project'
    );
    if (newName) {
      this.exportIpc.setProjectName(newName);
      await this.triggerMobileSave();
    }
  }

  triggerUndo(): void {
    this.undoRedo.triggerUndo();
  }

  triggerRedo(): void {
    this.undoRedo.triggerRedo();
  }

  setTheme(theme: 'system' | 'white' | 'light' | 'sepia' | 'dark' | 'black'): void {
    this.themeService.applyTheme(theme);
  }

  triggerMobileAbout(): void {
    if (this.platformFile.isNative) {
      this.openMobileAbout.emit();
    } else {
      window.open('?dialog=about', '_blank', 'width=320,height=260,noopener,noreferrer');
    }
  }

  async triggerMobileSave(): Promise<void> {
    try {
      const zipData = await this.sbd.buildSbdZip();
      const fileName = (this.exportIpc.defaultPrefix() || 'project') + '.sbd';
      const confirmed = await this.platformFile.saveFile(zipData, fileName);
      // Only show the toast when we know the save completed (web/desktop).
      // On native the share sheet is the feedback; we can't confirm the user saved.
      if (confirmed) {
        this.saveService.saveStatus.set('Saved!');
        setTimeout(() => {
          if (this.saveService.saveStatus() === 'Saved!') {
            this.saveService.saveStatus.set(null);
          }
        }, 2000);
      }
    } catch (e) {
      console.error('Save failed', e);
      window.alert('Failed to save file: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async triggerLoad(): Promise<void> {
    try {
      const result = await this.platformFile.pickAndReadFile('.sbd');
      if (!result) return;
      await this.sbd.loadSbdZip(result.data);
      this.undoRedo.clear();
      const stem = result.name.replace(/\.[^.]+$/, '');
      if (stem) this.exportIpc.setProjectName(stem);
    } catch (e) {
      console.error('Load failed', e);
      window.alert('Failed to load file: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  triggerMobileExport(): void {
    const list = this.sbd['store'].boards();
    this.exportIpc.settingsBoardCount.set(list.length);
    this.exportIpc.settingsVisible.set(true);
  }

  triggerSettings(): void {
    window.open('?dialog=settings', '_blank', 'width=750,height=700,noopener,noreferrer');
  }
}
