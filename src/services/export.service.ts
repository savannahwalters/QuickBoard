import { Injectable, inject, signal } from '@angular/core';
import { AppStore } from '../data/store/app.store';
import { CanvasDataService } from './canvas-data.service';
import { BoilService } from '../ui/canvas/boil/boil.service';
import type { LCInstance } from '../ui/canvas/literally-canvas-interfaces';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { ExportSettings } from '../ui/export-settings/export-resolutions';
import type { AudioTrack } from '../data';
import type { Board } from '../data/store/app.store';
import { appSettings } from 'src/settings-loader';

interface JsPdfInstance {
  internal: {
    pageSize: {
      getWidth(): number;
      getHeight(): number;
    };
  };
  setDrawColor(...args: number[]): void;
  setFillColor(...args: number[]): void;
  setLineWidth(width: number): void;
  setFont(fontName: string, fontStyle?: string): void;
  setFontSize(size: number): void;
  addImage(
    imageData: string,
    format: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): void;
  rect(x: number, y: number, width: number, height: number, style?: string): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  text(text: string | string[], x: number, y: number, options?: Record<string, unknown>): void;
  splitTextToSize(text: string, maxWidth: number): string[];
  getTextWidth(text: string): number;
  addPage(): void;
  setPage(pageNumber: number): void;
  output(type: 'arraybuffer'): unknown;
}

interface PdfLayoutMetrics {
  pageWidth: number;
  pageHeight: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
  gutterX: number;
  gutterY: number;
  boardsPerRow: number;
  cardWidth: number;
  cardPadding: number;
  contentWidth: number;
  imageHeight: number;
  headerHeight: number;
  imgGap: number;
  scriptGap: number;
  scriptFontSize: number;
  lineHeight: number;
  bottomPad: number;
  scriptHeight: number;
  cardHeight: number;
}

interface BoardLayoutEntry {
  page: number;
  cardX: number;
  cardY: number;
  cardHeight: number;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  readonly store = inject(AppStore);
  readonly canvasDataService = inject(CanvasDataService);
  private readonly boil = inject(BoilService);

  readonly isExporting = signal(false);
  readonly exportProgress = signal(0);
  readonly exportMessage = signal('');

  private ffmpeg: FFmpeg | null = null;

  async renderBoardsAtScale(
    scale: number,
    prefix: string,
    onProgress?: (current: number, total: number, fileName: string) => void
  ): Promise<{ name: string; dataUrl: string }[]> {
    const boards = this.store.boards();
    const padLength = Math.max(3, String(boards.length).length);
    const frames: { name: string; dataUrl: string }[] = [];

    for (let index = 0; index < boards.length; index++) {
      const board = boards[index];
      const frameNum = String(index + 1).padStart(padLength, '0');
      const fileName = `${prefix}_${frameNum}.png`;

      const dataUrl = await this.renderSingleBoard(
        this.canvasDataService.getCanvasData(board.id),
        board.backgroundColor,
        scale
      );
      frames.push({ name: fileName, dataUrl });
      onProgress?.(index + 1, boards.length, fileName);
    }

    return frames;
  }

  private renderSingleBoard(
    canvasData: Record<string, unknown> | null,
    backgroundColor: string,
    scale: number,
    mimeType = 'image/png'
  ): Promise<string> {
    return new Promise((resolve) => {
      const container = document.createElement('div');
      container.style.cssText =
        'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
      document.body.appendChild(container);

      let lc: LCInstance | null = null;
      try {
        lc = LC.init(container, { imageURLPrefix: 'assets/lc-images' });
        lc.setImageSize(this.store.width(), this.store.height());
        if (canvasData) {
          lc.loadSnapshot(canvasData);
        } else {
          lc.repaintLayer('main');
        }
        lc.setColor('background', backgroundColor ?? appSettings.canvas.defaultBackgroundColor);
        const dataUrl = lc.getImage({ scale }).toDataURL(mimeType, 0.9);
        resolve(dataUrl);
      } catch {
        // Fall back to a blank white frame on error
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(this.store.width() * scale);
        canvas.height = Math.round(this.store.height() * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = backgroundColor ?? appSettings.canvas.defaultBackgroundColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        resolve(canvas.toDataURL(mimeType, 0.9));
      } finally {
        try {
          lc?.teardown();
        } catch {
          // ignore teardown errors
        }
        document.body.removeChild(container);
      }
    });
  }

  async renderBoardsAtScaleStreaming(
    scale: number,
    prefix: string,
    onFrame: (
      frame: { name: string; dataUrl: string },
      current: number,
      total: number
    ) => Promise<void>,
    mimeType = 'image/png',
    abortSignal?: AbortSignal,
    startIndex = 0,
    endIndex?: number,
    boardsSnapshot?: Board[]
  ): Promise<void> {
    const allBoards = boardsSnapshot ?? this.store.boards();
    const end = endIndex ?? allBoards.length - 1;
    const boards = allBoards.slice(startIndex, end + 1);
    const padLength = Math.max(3, String(allBoards.length).length);
    const ext = mimeType === 'image/jpeg' ? '.jpg' : '.png';
    for (let i = 0; i < boards.length; i++) {
      this.throwIfAborted(abortSignal);
      const board = boards[i];
      const frameNum = String(startIndex + i + 1).padStart(padLength, '0');
      const fileName = `${prefix}_${frameNum}${ext}`;
      const dataUrl = await this.renderSingleBoard(
        this.canvasDataService.getCanvasData(board.id),
        board.backgroundColor,
        scale,
        mimeType
      );
      this.throwIfAborted(abortSignal);
      await onFrame({ name: fileName, dataUrl }, i + 1, boards.length);
      this.throwIfAborted(abortSignal);
    }
  }

  private throwIfAborted(abortSignal?: AbortSignal): void {
    if (abortSignal?.aborted) {
      throw new Error('Export canceled by user.');
    }
  }

  private async loadFFmpeg(): Promise<FFmpeg> {
    if (this.ffmpeg) return this.ffmpeg;

    this.exportMessage.set('Loading video engine...');
    const ffmpeg = new FFmpeg();

    ffmpeg.on('progress', ({ progress }) => {
      this.exportProgress.set(Math.round(progress * 100));
    });

    const isElectron = window.location.protocol === 'app:';
    const coreBaseURL = isElectron ? 'app://localhost/assets/ffmpeg/core' : '/assets/ffmpeg/core';

    const coreURL = await toBlobURL(`${coreBaseURL}/ffmpeg-core.js`, 'application/javascript');
    const wasmURL = await toBlobURL(`${coreBaseURL}/ffmpeg-core.wasm`, 'application/wasm');
    const classWorkerURL = isElectron
      ? 'app://localhost/assets/ffmpeg/worker/worker.js'
      : '/assets/ffmpeg/worker/worker.js';

    await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });

    this.ffmpeg = ffmpeg;
    return ffmpeg;
  }

  async exportVideoWithSettings(
    settings: ExportSettings,
    onFrameProgress?: (current: number, total: number, fileName: string) => void,
    onPhaseMessage?: (message: string) => void,
    onEncodingProgress?: (progress: number) => void,
    abortSignal?: AbortSignal
  ): Promise<Uint8Array> {
    const allBoards = this.store.boards().slice();
    const audioTracks = this.store.audioTracks();
    const startIndex = settings.startIndex;
    const endIndex = settings.endIndex;
    const boards = allBoards.slice(startIndex, endIndex + 1);

    if (!boards.length) {
      const message =
        'There are no boards to export. Please add at least one board before exporting a video.';
      this.exportMessage.set(message);
      throw new Error(message);
    }

    onPhaseMessage?.('Loading video engine...');
    const ffmpeg = await this.loadFFmpeg();
    if (abortSignal?.aborted) throw new Error('Export canceled by user.');

    onPhaseMessage?.('Rendering frames...');
    let concatText = '';
    const writtenFrames: string[] = [];
    const safePrefix = this.sanitizePrefix(settings.prefix);

    // Expand each board into one or more timed segments. Boil-enabled boards
    // fan out into cycling jitter variations so the exported video wiggles.
    const fps = this.store.fps();
    const segmentPlan = boards.flatMap((board) =>
      this.boil
        .expandBoardToSegments(board, this.canvasDataService.getCanvasData(board.id), fps)
        .map((segment) => ({ board, segment }))
    );
    const totalSegments = segmentPlan.length;
    const padLength = Math.max(3, String(totalSegments).length);

    for (let index = 0; index < segmentPlan.length; index++) {
      this.throwIfAborted(abortSignal);
      const { board, segment } = segmentPlan[index];
      const frameNum = String(index + 1).padStart(padLength, '0');
      const frameName = `${safePrefix}_${frameNum}.jpg`;

      const dataUrl = await this.renderSingleBoard(
        segment.snapshot,
        board.backgroundColor,
        settings.resolution.scale,
        'image/jpeg'
      );
      this.throwIfAborted(abortSignal);

      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      await ffmpeg.writeFile(frameName, bytes);
      writtenFrames.push(frameName);

      concatText += `file '${frameName}'\n`;
      if (index < totalSegments - 1) {
        concatText += `duration ${segment.durationSeconds}\n`;
      }
      onFrameProgress?.(index + 1, totalSegments, frameName);
      this.throwIfAborted(abortSignal);
    }

    if (abortSignal?.aborted) throw new Error('Export canceled by user.');

    await ffmpeg.writeFile('concat.txt', concatText);

    const ffmpegArgs: string[] = ['-f', 'concat', '-safe', '0', '-i', 'concat.txt'];
    const writtenAudio: string[] = [];

    const timeOffset = allBoards
      .slice(0, startIndex)
      .reduce((sum, b) => sum + (b.duration ?? 3), 0);
    const exportDuration = boards.reduce((sum, b) => sum + (b.duration ?? 3), 0);

    const activeAudioTracks = audioTracks.filter((track) => {
      const absoluteStartTime = track.startTime;
      const trackEndTime = track.duration > 0 ? absoluteStartTime + track.duration : Infinity;
      return trackEndTime > timeOffset && absoluteStartTime < timeOffset + exportDuration;
    });

    if (activeAudioTracks.length > 0) {
      onPhaseMessage?.('Processing audio...');
      let filterStr = '';
      let amixInputs = '';

      for (let i = 0; i < activeAudioTracks.length; i++) {
        const track: AudioTrack = activeAudioTracks[i];

        const response = await fetch(track.url);
        const blob = await response.blob();

        let audioExtension = 'mp3';
        const urlExtMatch = track.url.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
        if (urlExtMatch && urlExtMatch[1]) {
          audioExtension = urlExtMatch[1].toLowerCase();
        }

        if (
          (!audioExtension || audioExtension === 'mp3') &&
          blob.type &&
          blob.type.startsWith('audio/')
        ) {
          const mimeSubtype = blob.type.split('/')[1]?.split(';')[0]?.toLowerCase();
          if (mimeSubtype) {
            switch (mimeSubtype) {
              case 'mpeg':
                audioExtension = 'mp3';
                break;
              case 'x-wav':
              case 'wav':
                audioExtension = 'wav';
                break;
              case 'ogg':
                audioExtension = 'ogg';
                break;
              case 'webm':
                audioExtension = 'webm';
                break;
              case 'aac':
                audioExtension = 'aac';
                break;
              default:
                audioExtension = mimeSubtype;
                break;
            }
          }
        }

        const audioFileName = `audio_${i}.${audioExtension}`;
        await ffmpeg.writeFile(audioFileName, await fetchFile(blob));
        writtenAudio.push(audioFileName);

        ffmpegArgs.push('-i', audioFileName);

        const absoluteStartTime = track.startTime;
        let trackTrimStart = Math.max(0, track.trimStart);
        let trackDuration = track.duration;
        let delayMs = 0;

        if (absoluteStartTime >= timeOffset) {
          delayMs = Math.floor((absoluteStartTime - timeOffset) * 1000);
        } else {
          // starts before the exported range
          const overlap = timeOffset - absoluteStartTime;
          trackTrimStart += overlap;
          if (trackDuration > 0) {
            trackDuration = Math.max(0, trackDuration - overlap);
          }
          // delayMs remains 0
        }

        const hasTrimStart = trackTrimStart > 0;
        const hasDuration = trackDuration > 0;

        if (hasTrimStart || hasDuration) {
          let filterChain = `[${i + 1}:a]atrim=`;

          if (hasTrimStart) {
            filterChain += `start=${trackTrimStart}`;
          } else {
            filterChain += 'start=0';
          }

          if (hasDuration) {
            filterChain += `:duration=${trackDuration}`;
          }

          filterChain += `,asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[a${i}];`;
          filterStr += filterChain;
        } else {
          filterStr += `[${i + 1}:a]adelay=${delayMs}|${delayMs}[a${i}];`;
        }

        amixInputs += `[a${i}]`;
      }

      if (abortSignal?.aborted) throw new Error('Export canceled by user.');

      filterStr += `${amixInputs}amix=inputs=${activeAudioTracks.length}:normalize=0[aout]`;
      ffmpegArgs.push('-filter_complex', filterStr);
      ffmpegArgs.push('-map', '0:v');
      ffmpegArgs.push('-map', '[aout]');
    } else {
      ffmpegArgs.push('-map', '0:v');
    }

    ffmpegArgs.push(
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-t',
      String(exportDuration),
      'output.mp4'
    );

    onPhaseMessage?.('Encoding video...');

    let foundFirstTime = false;
    const totalDuration = boards.reduce((sum, b) => sum + (b.duration ?? 3), 0);
    const logHandler = ({ message }: { message: string }) => {
      const timeMatch = message.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch && totalDuration > 0) {
        foundFirstTime = true;
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const seconds = parseFloat(timeMatch[3]);
        const currentTime = hours * 3600 + minutes * 60 + seconds;
        let p = (currentTime / totalDuration) * 100;
        p = Math.max(0, Math.min(100, Math.round(p)));
        onEncodingProgress?.(p);
      } else if (!foundFirstTime && !message.includes('time=')) {
        onEncodingProgress?.(0);
      }
    };
    ffmpeg.on('log', logHandler);

    const abortHandler = () => {
      ffmpeg.terminate();
      this.ffmpeg = null;
    };
    abortSignal?.addEventListener('abort', abortHandler, { once: true });

    try {
      await ffmpeg.exec(ffmpegArgs);
    } catch (e) {
      if (abortSignal?.aborted) {
        throw new Error('Export canceled by user.');
      }
      throw e;
    } finally {
      ffmpeg.off('log', logHandler);
      abortSignal?.removeEventListener('abort', abortHandler);
    }

    if (abortSignal?.aborted) throw new Error('Export canceled by user.');
    onEncodingProgress?.(100);

    onPhaseMessage?.('Saving file...');
    const fileData = await ffmpeg.readFile('output.mp4');
    const result =
      fileData instanceof Uint8Array
        ? fileData
        : new Uint8Array(fileData as unknown as ArrayBuffer);

    for (const f of [...writtenFrames, ...writtenAudio, 'concat.txt', 'output.mp4']) {
      try {
        await ffmpeg.deleteFile(f);
      } catch {
        // ignore
      }
    }

    return result;
  }

  private sanitizePrefix(prefix: string): string {
    if (!prefix) {
      return 'frame';
    }
    return prefix.replace(/['"\r\n/\\]/g, '_');
  }

  private async yieldToMainThread(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  private formatStoryboardTimestamp(seconds: number): string {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(wholeSeconds / 60);
    const remainingSeconds = wholeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  private formatStoryboardDuration(seconds: number): string {
    const safeSeconds = Math.max(0, seconds || 0);
    if (Number.isInteger(safeSeconds)) {
      return `${safeSeconds}s`;
    }
    return `${safeSeconds.toFixed(1)}s`;
  }

  private extractScriptText(board: Board | undefined): string {
    const blocks = board?.scriptData?.blocks ?? [];
    return blocks
      .map((block) => {
        const text = typeof block?.data?.text === 'string' ? block.data.text : '';
        return text
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      })
      .filter((text) => text.length > 0)
      .join('\n');
  }

  private buildPdfLayout(
    pageWidth: number,
    pageHeight: number,
    boardsPerRow: number
  ): PdfLayoutMetrics {
    const safeBoardsPerRow = Math.max(1, Math.min(4, boardsPerRow));
    const marginX = 28;
    const marginTop = 28;
    const marginBottom = 28;
    const gutterX = 12;
    const gutterY = 12;
    const cardPadding = 6;
    const availableWidth = pageWidth - marginX * 2 - gutterX * (safeBoardsPerRow - 1);
    const cardWidth = availableWidth / safeBoardsPerRow;
    const contentWidth = cardWidth - cardPadding * 2;
    const imageHeight = cardWidth * (this.store.height() / this.store.width());
    const headerHeight = 26;
    const imgGap = cardPadding;
    const scriptGap = cardPadding;
    const scriptFontSize = 9;
    const lineHeight = 11;
    const bottomPad = 6;
    // Compute scriptHeight so that 3 rows fit on the page.
    const fixedOverhead = headerHeight + imgGap + scriptGap + bottomPad;
    const usableHeight = pageHeight - marginTop - marginBottom;
    const targetCardHeight = (usableHeight - gutterY * 2) / 3;
    const scriptHeight = Math.max(
      lineHeight,
      Math.floor(targetCardHeight - imageHeight - fixedOverhead)
    );
    const cardHeight = fixedOverhead + imageHeight + scriptHeight;

    return {
      pageWidth,
      pageHeight,
      marginX,
      marginTop,
      marginBottom,
      gutterX,
      gutterY,
      boardsPerRow: safeBoardsPerRow,
      cardWidth,
      cardPadding,
      contentWidth,
      imageHeight,
      headerHeight,
      imgGap,
      scriptGap,
      scriptFontSize,
      lineHeight,
      bottomPad,
      scriptHeight,
      cardHeight,
    };
  }

  private buildFullScriptLayout(
    boards: Board[],
    layout: PdfLayoutMetrics,
    doc: JsPdfInstance
  ): BoardLayoutEntry[] {
    const fixedOverhead =
      layout.headerHeight +
      layout.imgGap +
      layout.imageHeight +
      layout.scriptGap +
      layout.bottomPad;
    const pageBottom = layout.pageHeight - layout.marginBottom;
    const results: BoardLayoutEntry[] = [];
    let currentPage = 1;
    let currentY = layout.marginTop;

    for (let i = 0; i < boards.length; i += layout.boardsPerRow) {
      const rowBoards = boards.slice(i, i + layout.boardsPerRow);
      let maxLines = 1;
      for (const board of rowBoards) {
        const scriptText = this.extractScriptText(board);
        if (scriptText) {
          const lines = doc.splitTextToSize(scriptText, layout.contentWidth);
          maxLines = Math.max(maxLines, lines.length);
        }
      }
      const rowCardHeight = Math.ceil(fixedOverhead + maxLines * layout.lineHeight);
      // Start a new page if this row doesn't fit (skip check on first row to avoid infinite loop).
      if (results.length > 0 && currentY + rowCardHeight > pageBottom) {
        currentPage++;
        currentY = layout.marginTop;
      }
      for (let j = 0; j < rowBoards.length; j++) {
        const cardX = layout.marginX + j * (layout.cardWidth + layout.gutterX);
        results.push({ page: currentPage, cardX, cardY: currentY, cardHeight: rowCardHeight });
      }
      currentY += rowCardHeight + layout.gutterY;
    }

    return results;
  }

  private drawStoryboardBoard(
    doc: JsPdfInstance,
    frameDataUrl: string,
    board: Board | undefined,
    boardNumber: number,
    startTimeSeconds: number,
    x: number,
    y: number,
    layout: PdfLayoutMetrics,
    options: { fullScript?: boolean; actualCardHeight?: number } = {}
  ): void {
    const { fullScript = false, actualCardHeight = layout.cardHeight } = options;
    const { cardPadding, contentWidth } = layout;
    const headerBottom = y + layout.headerHeight;
    const imageY = headerBottom + layout.imgGap;
    const scriptY = imageY + layout.imageHeight + layout.scriptGap;
    const boardDuration = board?.duration ?? appSettings.board.defaultDuration;
    const timestampText = this.formatStoryboardTimestamp(startTimeSeconds);
    const durationText = this.formatStoryboardDuration(boardDuration);
    const scriptText = this.extractScriptText(board);

    // Card outline
    doc.setDrawColor(32, 32, 32);
    doc.setLineWidth(0.8);
    doc.rect(x, y, layout.cardWidth, actualCardHeight, 'S');
    doc.line(x, headerBottom, x + layout.cardWidth, headerBottom);

    // Header section dividers
    const sectionWidth = layout.cardWidth / 3;
    doc.line(x + sectionWidth, y, x + sectionWidth, headerBottom);
    doc.line(x + sectionWidth * 2, y, x + sectionWidth * 2, headerBottom);

    // Header labels
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('BOARD', x + 5, y + 10);
    doc.text('TIME', x + sectionWidth + 5, y + 10);
    doc.text('LENGTH', x + sectionWidth * 2 + 5, y + 10);

    // Header values
    doc.setFontSize(10);
    doc.text(String(boardNumber), x + 5, y + 23);
    doc.text(timestampText, x + sectionWidth + 5, y + 23);
    doc.text(durationText, x + sectionWidth * 2 + 5, y + 23);

    // Board image
    doc.addImage(frameDataUrl, 'JPEG', x + cardPadding, imageY, contentWidth, layout.imageHeight);
    doc.rect(x + cardPadding, imageY, contentWidth, layout.imageHeight, 'S');

    // Script text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(layout.scriptFontSize);
    const scriptLines = scriptText
      ? doc.splitTextToSize(scriptText, contentWidth)
      : ['No script for this board.'];

    if (fullScript) {
      doc.text(scriptLines, x + cardPadding, scriptY, { maxWidth: contentWidth, baseline: 'top' });
    } else {
      const availableScriptH =
        actualCardHeight -
        (layout.headerHeight +
          layout.imgGap +
          layout.imageHeight +
          layout.scriptGap +
          layout.bottomPad);
      const maxLines = Math.max(1, Math.floor(availableScriptH / layout.lineHeight));
      const trimmedLines = scriptLines.slice(0, maxLines);
      if (scriptLines.length > maxLines && trimmedLines.length > 0) {
        const lastLine = trimmedLines[trimmedLines.length - 1] ?? '';
        trimmedLines[trimmedLines.length - 1] = `${lastLine.replace(/[.\s]+$/, '')}...`;
      }
      doc.text(trimmedLines, x + cardPadding, scriptY, { maxWidth: contentWidth, baseline: 'top' });
    }
  }

  async exportPDFWithSettings(
    settings: ExportSettings,
    onProgress?: (current: number, total: number, fileName: string) => void,
    abortSignal?: AbortSignal
  ): Promise<Uint8Array> {
    this.throwIfAborted(abortSignal);
    const { jsPDF } = await import('jspdf');
    const pageFormat = settings.pdfPageSize === 'a4' ? 'a4' : 'letter';
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: pageFormat,
    }) as JsPdfInstance;

    const allBoards = this.store.boards().slice();
    const boards = allBoards.slice(settings.startIndex, settings.endIndex + 1);

    if (!boards.length) {
      throw new Error('There are no boards to export in the selected range.');
    }
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const layout = this.buildPdfLayout(pageWidth, pageHeight, settings.boardsPerRow);
    const isFullScript = settings.pdfScriptMode === 'full';

    // For full-script mode pre-compute per-board layout and pre-create pages.
    let boardLayouts: BoardLayoutEntry[] | null = null;
    let boardsPerPage = 0;
    let currentPage = 1;

    if (isFullScript) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(layout.scriptFontSize);
      boardLayouts = this.buildFullScriptLayout(boards, layout, doc);
      const totalPages = boardLayouts.reduce((max, l) => Math.max(max, l.page), 1);
      for (let p = 1; p < totalPages; p++) {
        doc.addPage();
      }
    } else {
      const usableHeight = pageHeight - layout.marginTop - layout.marginBottom;
      const boardsPerColumn = Math.max(
        1,
        Math.floor((usableHeight + layout.gutterY) / (layout.cardHeight + layout.gutterY))
      );
      boardsPerPage = layout.boardsPerRow * boardsPerColumn;
    }

    let runningTimestampSeconds = allBoards
      .slice(0, settings.startIndex)
      .reduce((sum, board) => sum + (board.duration ?? appSettings.board.defaultDuration), 0);

    await this.renderBoardsAtScaleStreaming(
      settings.resolution.scale,
      settings.prefix,
      async (frame, current, total) => {
        this.throwIfAborted(abortSignal);
        const boardIndex = current - 1;
        const board = boards[boardIndex];

        let cardX: number;
        let cardY: number;
        let actualCardHeight: number;

        if (boardLayouts) {
          const entry = boardLayouts[boardIndex];
          if (!entry) {
            return;
          }
          doc.setPage(entry.page);
          cardX = entry.cardX;
          cardY = entry.cardY;
          actualCardHeight = entry.cardHeight;
        } else {
          const nextPage = Math.floor(boardIndex / boardsPerPage) + 1;
          if (nextPage > currentPage) {
            doc.addPage();
            currentPage = nextPage;
          }
          const pageSlot = boardIndex % boardsPerPage;
          const colIndex = pageSlot % layout.boardsPerRow;
          const rowIndex = Math.floor(pageSlot / layout.boardsPerRow);
          cardX = layout.marginX + colIndex * (layout.cardWidth + layout.gutterX);
          cardY = layout.marginTop + rowIndex * (layout.cardHeight + layout.gutterY);
          actualCardHeight = layout.cardHeight;
        }

        this.drawStoryboardBoard(
          doc,
          frame.dataUrl,
          board,
          settings.startIndex + current,
          runningTimestampSeconds,
          cardX,
          cardY,
          layout,
          {
            fullScript: isFullScript,
            actualCardHeight,
          }
        );

        runningTimestampSeconds += board?.duration ?? appSettings.board.defaultDuration;

        onProgress?.(current, total, frame.name);

        // Allow the browser to paint progress updates during long PDF builds.
        await this.yieldToMainThread();
        this.throwIfAborted(abortSignal);
      },
      'image/jpeg',
      abortSignal,
      settings.startIndex,
      settings.endIndex,
      allBoards
    );

    this.throwIfAborted(abortSignal);
    const output: unknown = doc.output('arraybuffer');
    if (output instanceof ArrayBuffer) {
      return new Uint8Array(output);
    }

    if (ArrayBuffer.isView(output)) {
      return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
    }

    if (output && typeof output === 'object' && 'byteLength' in output) {
      return new Uint8Array(output as ArrayBufferLike);
    }

    throw new Error('Failed to generate PDF binary output.');
  }
}
