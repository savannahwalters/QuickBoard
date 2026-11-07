import { Component, forwardRef, input, NO_ERRORS_SCHEMA, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { ThemeService } from '../services/theme.service';
import { SaveService } from '../services/save.service';
import { ExportIpcService } from '../services/export-ipc.service';
import { WindowScalingService } from '../services/window-scaling.service';
import { UndoRedoService } from '../services/undo-redo.service';
import { AndroidOpenFileService } from '../services/android-open-file.service';
import { AppShortcutsService, IosIntegrationService } from '../services';
import { CanvasComponent } from '../ui/canvas/canvas/canvas.component';

@Component({
  selector: 'app-canvas',
  template: '',
  providers: [{ provide: CanvasComponent, useExisting: forwardRef(() => CanvasStub) }],
})
class CanvasStub {
  readonly isCanvasFullscreen = input(false);
  readonly canvasFullscreenToggled = output<void>();
  readonly flushCurrentBoardState = vi.fn();
}

@Component({ selector: 'app-web-toolbar', template: '' })
class ToolbarStub {
  readonly openMobileAbout = output<void>();
}

@Component({ selector: 'app-about-window', template: 'About QuickBoard' })
class AboutStub {}

describe('About dialog', () => {
  const originalUrl = window.location.href;

  afterEach(() => {
    TestBed.resetTestingModule();
    window.history.replaceState(null, '', originalUrl);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setup(platform: 'ios' | 'android' | 'web', electron = false) {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(platform !== 'web');
    vi.stubGlobal('quickboard', electron ? {} : undefined);
    let openIosDialog: ((dialog: 'about' | 'settings' | null) => void) | undefined;
    TestBed.configureTestingModule({
      providers: [
        { provide: ThemeService, useValue: { initTheme: vi.fn() } },
        {
          provide: SaveService,
          useValue: { init: vi.fn(), destroy: vi.fn(), saveStatus: () => null },
        },
        {
          provide: ExportIpcService,
          useValue: {
            init: vi.fn(),
            settingsVisible: () => false,
            settingsBoardCount: () => 0,
            defaultPrefix: () => '',
            defaultDirPath: () => '',
            settingsMode: () => '',
            exportVisible: () => false,
            exportCurrent: () => 0,
            exportTotal: () => 0,
            exportProgressPercent: () => 0,
            exportFrameCount: () => 0,
            exportFileName: () => '',
            exportStatus: () => '',
            exportMessage: () => '',
          },
        },
        { provide: WindowScalingService, useValue: { init: vi.fn() } },
        { provide: UndoRedoService, useValue: {} },
        { provide: AndroidOpenFileService, useValue: { init: vi.fn(), destroy: vi.fn() } },
        {
          provide: IosIntegrationService,
          useValue: {
            init: vi.fn((_delegate, callback) => {
              openIosDialog = callback;
            }),
            destroy: vi.fn(),
          },
        },
        { provide: AppShortcutsService, useValue: {} },
      ],
    });
    TestBed.overrideComponent(App, {
      set: {
        imports: [CanvasStub, ToolbarStub, AboutStub],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return { fixture, openIosDialog };
  }

  it.each(['android', 'ios'] as const)(
    'opens and closes the in-app About page on %s',
    (platform) => {
      const { fixture, openIosDialog } = setup(platform);
      const canvas = fixture.debugElement.query(By.directive(CanvasStub))
        .componentInstance as CanvasStub;
      if (platform === 'android') {
        const toolbar = fixture.debugElement.query(By.directive(ToolbarStub))
          .componentInstance as ToolbarStub;
        toolbar.openMobileAbout.emit();
      } else {
        openIosDialog?.('about');
      }
      fixture.detectChanges();
      expect(canvas.flushCurrentBoardState).toHaveBeenCalledOnce();
      expect(fixture.nativeElement.querySelector('app-about-window')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.app.dialog-hidden')).not.toBeNull();
      const close = fixture.nativeElement.querySelector('button.dialog-close') as HTMLButtonElement;
      expect(close).not.toBeNull();
      close.click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-about-window')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-canvas')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.app.dialog-hidden')).toBeNull();
      expect(fixture.debugElement.query(By.directive(CanvasStub)).componentInstance).toBe(canvas);
    }
  );

  it.each([false, true])('does not show the close button on desktop (Electron: %s)', (electron) => {
    window.history.replaceState(null, '', '?dialog=about');
    const { fixture } = setup('web', electron);
    expect(fixture.nativeElement.querySelector('app-about-window')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button.dialog-close')).toBeNull();
  });
});
