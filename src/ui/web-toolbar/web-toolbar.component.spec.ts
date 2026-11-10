import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SbdService } from '../../app/app.sbd.service';
import { ExportIpcService } from '../../services/export-ipc.service';
import { PlatformFileService } from '../../services/platform-file.service';
import { SaveService } from '../../services/save.service';
import { ThemeService } from '../../services/theme.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WebToolbarComponent } from './web-toolbar.component';

describe('web toolbar actions', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it.each([true, false])('uses the correct About navigation (native: %s)', (isNative) => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SbdService, useValue: {} },
        { provide: UndoRedoService, useValue: {} },
        { provide: ExportIpcService, useValue: {} },
        { provide: ThemeService, useValue: { currentTheme: () => 'system' } },
        { provide: SaveService, useValue: {} },
        { provide: PlatformFileService, useValue: { isNative } },
      ],
    });

    const toolbar = TestBed.createComponent(WebToolbarComponent).componentInstance;
    const emitted = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    toolbar.openMobileAbout.subscribe(emitted);

    toolbar.triggerMobileAbout();

    if (isNative) {
      expect(emitted).toHaveBeenCalledOnce();
      expect(open).not.toHaveBeenCalled();
    } else {
      expect(emitted).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith(
        '?dialog=about',
        '_blank',
        'width=320,height=260,noopener,noreferrer'
      );
    }
  });

  it('emits image import from the File menu and closes the dropdown', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SbdService, useValue: {} },
        { provide: UndoRedoService, useValue: {} },
        { provide: ExportIpcService, useValue: {} },
        { provide: ThemeService, useValue: { currentTheme: () => 'system' } },
        { provide: SaveService, useValue: {} },
        { provide: PlatformFileService, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(WebToolbarComponent);
    const emitted = vi.fn();
    fixture.componentInstance.importImage.subscribe(emitted);
    fixture.componentInstance.activeMenu.set('file');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const button = [...element.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === 'Import Image...'
    );
    expect(button).toBeDefined();
    button!.click();
    expect(emitted).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.activeMenu()).toBeNull();
    fixture.destroy();
  });
});
