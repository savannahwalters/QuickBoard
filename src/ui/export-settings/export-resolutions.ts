import { appSettings } from 'src/settings-loader';

export interface ExportResolution {
  label: string;
  scale: number;
  width: number;
  height: number;
}

export type PdfPageSize = 'letter' | 'a4';

export type PdfScriptMode = 'truncate' | 'full';

export interface PdfPageSizeOption {
  value: PdfPageSize;
  label: string;
}

export interface ExportSettings {
  format: 'png' | 'video' | 'pdf';
  resolution: ExportResolution;
  prefix: string;
  pdfPageSize: PdfPageSize;
  boardsPerRow: number;
  pdfScriptMode: PdfScriptMode;
  dirPath: string;
  startIndex: number;
  endIndex: number;
}

export const PDF_PAGE_SIZES: PdfPageSizeOption[] = [
  { value: 'letter', label: 'Letter · 8.5 × 11 in' },
  { value: 'a4', label: 'A4 · 210 × 297 mm' },
];

export function getExportResolutions(): ExportResolution[] {
  return (
    appSettings.export.resolutions ?? [
      { label: '480 × 270  — Draft', scale: 0.25, width: 480, height: 270 },
      { label: '960 × 540  — SD', scale: 0.5, width: 960, height: 540 },
      { label: '1920 × 1080  — Full HD', scale: 1, width: 1920, height: 1080 },
      { label: '3840 × 2160  — 4K', scale: 2, width: 3840, height: 2160 },
      { label: '7680 × 4320  — 8K', scale: 4, width: 7680, height: 4320 },
    ]
  );
}
