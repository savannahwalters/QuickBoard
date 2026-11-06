import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SbdService } from '../../app/app.sbd.service';
import { ExportIpcService } from '../../services/export-ipc.service';
import { PlatformFileService } from '../../services/platform-file.service';
import { SaveService } from '../../services/save.service';
import { ThemeService } from '../../services/theme.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WebToolbarComponent } from './web-toolbar.component';

describe('About toolbar action', () => {
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
});
