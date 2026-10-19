import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsComponent } from './settings.component';
import { AppSettingsService } from '../../../services/app-settings.service';
import { PlatformFileService } from '../../../services/platform-file.service';

describe('SettingsComponent hydration', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('displays saved zero values without replacing them with defaults', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PlatformFileService, useValue: { isNative: false, isIos: false } },
        { provide: AppSettingsService, useValue: {
          loadCurrentSettings: vi.fn().mockResolvedValue({
            canvas: { defaultTool: 'image' },
            audio: { defaultVolume: 0 }, tools: { bucketFill: { tolerance: 0 }, eraser: { size: 64 } },
          }),
          saveAllSettings: vi.fn().mockResolvedValue(undefined),
        } },
      ],
    });
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.componentInstance.ngOnInit();
    await vi.waitFor(() => {
      expect(fixture.componentInstance.defaultVolume()).toBe(0);
      expect(fixture.componentInstance.defaultTool()).toBe('pencil');
      expect(fixture.componentInstance.bucketFillTolerance()).toBe(0);
      expect(fixture.componentInstance.eraserSize()).toBe(64);
    });
  });
});
