import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { inject } from '@angular/core';
import { getExportResolutions, PDF_PAGE_SIZES } from './export-resolutions';
import type { ExportSettings } from './export-resolutions';
import type { PdfPageSize, PdfScriptMode } from './export-resolutions';
import { PlatformFileService, IOS_DEFAULT_FOLDER } from '../../services/platform-file.service';
import { appSettings } from 'src/settings-loader';

@Component({
  selector: 'app-export-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './export-settings.component.html',
  styleUrl: './export-settings.component.css',
})
export class ExportSettingsComponent {
  private readonly platformFile = inject(PlatformFileService);
  visible = input<boolean>(false);
  boardCount = input<number>(0);
  defaultPrefix = input<string>('board');
  defaultDirPath = input<string>('');
  exportType = input<'png' | 'video' | 'pdf'>('png');
  confirmExport = output<ExportSettings>();
  cancelExport = output<void>();

  protected readonly resolutions = getExportResolutions();
  protected readonly pdfPageSizes = PDF_PAGE_SIZES;
  protected selectedIndex = signal(
    Math.max(
      0,
      Math.min(
        Number.isFinite(appSettings.export?.defaultResolutionIndex)
          ? (appSettings.export?.defaultResolutionIndex as number)
          : 2,
        this.resolutions.length - 1
      )
    )
  );
  protected startIndex = signal(0);
  protected endIndex = signal(this.boardCount() - 1);
  protected startRaw = signal('1');
  protected endRaw = signal(String(this.boardCount()));
  protected selectedFormat = signal<'png' | 'video' | 'pdf'>('png');
  protected selectedPdfPageSize = signal<PdfPageSize>('letter');
  protected boardsPerRow = signal(3);
  protected pdfScriptMode = signal<PdfScriptMode>('full');
  protected prefix = signal('board');
  protected dirPath = signal('');
  protected isBrowsing = signal(false);
  protected readonly boardsPerPageEstimate = computed(() => this.boardsPerRow() * 3);

  protected readonly selectedResolution = computed(() => {
    const idx = Math.max(0, Math.min(this.selectedIndex(), this.resolutions.length - 1));
    return this.resolutions[idx] ?? this.resolutions[0];
  });
  private readonly defaultIpadDir = IOS_DEFAULT_FOLDER;

  constructor() {
    // Sync internal signals from inputs each time the dialog opens.
    effect(() => {
      if (this.visible()) {
        this.selectedFormat.set(this.exportType());
        this.selectedPdfPageSize.set('letter');
        this.boardsPerRow.set(3);
        this.pdfScriptMode.set('full');
        this.prefix.set(this.defaultPrefix() || 'board');
        this.dirPath.set(
          this.defaultDirPath() || (this.platformFile.isIos ? this.defaultIpadDir : '')
        );
        this.startIndex.set(0);
        this.endIndex.set(this.boardCount() - 1);
        this.startRaw.set('1');
        this.endRaw.set(String(this.boardCount()));
      }
    });
  }

  protected onFormatChange(event: Event): void {
    const nextValue = (event.target as HTMLSelectElement).value;
    this.selectedFormat.set(nextValue === 'video' ? 'video' : nextValue === 'pdf' ? 'pdf' : 'png');
  }

  protected onPdfPageSizeChange(event: Event): void {
    const nextValue = (event.target as HTMLSelectElement).value;
    this.selectedPdfPageSize.set(nextValue === 'a4' ? 'a4' : 'letter');
  }

  protected onBoardsPerRowChange(event: Event): void {
    const parsed = parseInt((event.target as HTMLSelectElement).value, 10);
    const nextValue = Number.isNaN(parsed) ? this.boardsPerRow() : parsed;
    this.boardsPerRow.set(Math.max(1, Math.min(4, nextValue)));
  }

  protected onPdfScriptModeChange(event: Event): void {
    const nextValue = (event.target as HTMLSelectElement).value;
    this.pdfScriptMode.set(nextValue === 'full' ? 'full' : 'truncate');
  }

  protected onSelectChange(event: Event): void {
    const parsed = parseInt((event.target as HTMLSelectElement).value, 10);
    const clamped = Number.isNaN(parsed)
      ? this.selectedIndex()
      : Math.max(0, Math.min(parsed, this.resolutions.length - 1));
    this.selectedIndex.set(clamped);
  }

  protected onPrefixChange(event: Event): void {
    this.prefix.set((event.target as HTMLInputElement).value);
  }

  protected onStartInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.startRaw.set(raw);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(1, Math.min(parsed, this.boardCount()));
      this.startIndex.set(clamped - 1);
      if (this.endIndex() < clamped - 1) {
        this.endIndex.set(clamped - 1);
        this.endRaw.set(String(clamped));
      }
    }
  }

  protected onStartBlur(): void {
    this.startRaw.set(String(this.startIndex() + 1));
  }

  protected onEndInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.endRaw.set(raw);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(1, Math.min(parsed, this.boardCount()));
      this.endIndex.set(clamped - 1);
      if (this.startIndex() > clamped - 1) {
        this.startIndex.set(clamped - 1);
        this.startRaw.set(String(clamped));
      }
    }
  }

  protected onEndBlur(): void {
    this.endRaw.set(String(this.endIndex() + 1));
  }

  protected async onBrowse(): Promise<void> {
    this.isBrowsing.set(true);
    try {
      const chosen = await this.platformFile.pickExportDir();
      if (chosen) this.dirPath.set(chosen);
    } finally {
      this.isBrowsing.set(false);
    }
  }

  protected onConfirm(): void {
    const rawPrefix = this.prefix().trim();
    const safePrefix = rawPrefix.length > 0 ? rawPrefix : 'board';

    // Always export whole project for video format
    const isVideo = this.selectedFormat() === 'video';
    const startIndex = isVideo ? 0 : this.startIndex();
    const endIndex = isVideo ? this.boardCount() - 1 : this.endIndex();

    this.confirmExport.emit({
      format: this.selectedFormat(),
      resolution: this.selectedResolution(),
      pdfPageSize: this.selectedPdfPageSize(),
      boardsPerRow: this.boardsPerRow(),
      pdfScriptMode: this.pdfScriptMode(),
      prefix: safePrefix,
      dirPath: this.dirPath(),
      startIndex,
      endIndex,
    });
  }

  protected onCancel(): void {
    this.cancelExport.emit();
  }
}
