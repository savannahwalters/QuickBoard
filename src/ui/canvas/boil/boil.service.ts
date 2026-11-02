import { computed, inject, Injectable, signal } from '@angular/core';
import { AppStore, Board } from '../../../data/store/app.store';
import { CanvasDataService } from '../../../services/canvas-data.service';
import { appSettings } from 'src/settings-loader';
import { LCInstance } from '../literally-canvas-interfaces';
import { BoilParams, BoilSegment } from './boil.types';

/**
 * Generates the "line boiling" effect: a board's drawing is redrawn with small
 * procedural jitter across a handful of variations, which are then cycled during
 * playback (and export) to give animation that hand-drawn wiggle.
 *
 * Variations are derived purely from the original snapshot, so nothing extra is
 * persisted — only the per-board `boilEnabled` flag and optional per-frame
 * parameter overrides are stored.
 */
@Injectable({ providedIn: 'root' })
export class BoilService {
  private readonly store = inject(AppStore);
  private readonly canvasDataService = inject(CanvasDataService);

  /** Rendered, opaque variation image data URLs, keyed by board id. */
  private readonly variationImages = signal<Record<string, string[]>>({});
  /** Cache key (snapshot ref + param signature) each variation set was built from. */
  private readonly variationRefs = new Map<string, { ref: unknown; sig: string }>();

  /** Global defaults from settings, used when a frame has no override. */
  readonly defaults: BoilParams = {
    variations: Math.max(2, Math.round(appSettings.boil?.variations ?? 3)),
    holdFrames: Math.max(1, Math.round(appSettings.boil?.holdFrames ?? 2)),
    amount: Math.max(0, appSettings.boil?.amount ?? 2.5),
  };

  /** Resolve the effective boil parameters for a board (per-frame over defaults). */
  resolveParams(board: Pick<Board, 'boilParams'>): BoilParams {
    const override = board.boilParams;
    return {
      variations: Math.max(
        2,
        Math.min(12, Math.round(override?.variations ?? this.defaults.variations))
      ),
      holdFrames: Math.max(
        1,
        Math.min(24, Math.round(override?.holdFrames ?? this.defaults.holdFrames))
      ),
      amount: Math.max(0, Math.min(20, override?.amount ?? this.defaults.amount)),
    };
  }

  /**
   * The variation image to overlay on the live canvas right now, or null when
   * boil should not be shown (idle, board not boiled, or not yet rendered).
   */
  readonly currentBoilImage = computed<string | null>(() => {
    if (!this.store.isPlaying()) {
      return null;
    }

    const boards = this.store.boards();
    const currentBoardId = this.store.currentBoardId();
    if (!currentBoardId) {
      return null;
    }

    let startTime = 0;
    let board: Board | null = null;
    for (const candidate of boards) {
      if (candidate.id === currentBoardId) {
        board = candidate;
        break;
      }
      startTime += candidate.duration ?? 0;
    }

    if (!board || !board.boilEnabled) {
      return null;
    }

    const variations = this.variationImages()[currentBoardId];
    if (!variations || variations.length === 0) {
      return null;
    }

    const params = this.resolveParams(board);
    const fps = this.store.fps() || 24;
    const localTime = Math.max(0, this.store.currentTime() - startTime);
    const frame = Math.floor(localTime * fps);
    const index = Math.floor(frame / params.holdFrames) % variations.length;
    return variations[index] ?? null;
  });

  /**
   * Ensure variation images exist for a boil-enabled board. Re-renders when the
   * board's drawing or boil parameters have changed. Safe to call often.
   */
  ensureVariations(board: Board): void {
    if (!board.boilEnabled) {
      return;
    }

    const params = this.resolveParams(board);
    const sig = this.paramsSignature(params);
    const canvasData = this.canvasDataService.getCanvasData(board.id);
    const cached = this.variationRefs.get(board.id);
    if (cached && cached.ref === canvasData && cached.sig === sig && this.variationImages()[board.id]) {
      return;
    }

    const images = this.renderVariations(board.id, canvasData, board.backgroundColor, params);
    this.variationRefs.set(board.id, { ref: canvasData, sig });
    this.variationImages.update((cache) => ({ ...cache, [board.id]: images }));
  }

  /** Drop cached variations for a board (e.g. after an edit or boil toggle off). */
  clearBoard(boardId: string): void {
    this.variationRefs.delete(boardId);
    const cache = this.variationImages();
    if (!(boardId in cache)) {
      return;
    }
    this.variationImages.update((current) => {
      const next = { ...current };
      delete next[boardId];
      return next;
    });
  }

  /**
   * Expand a board into the timed variation segments used by video export.
   * Non-boil boards collapse to a single full-duration segment.
   */
  expandBoardToSegments(
    board: Board,
    canvasData: Record<string, unknown> | null,
    fps: number
  ): BoilSegment[] {
    const total = board.duration ?? 0;
    if (!board.boilEnabled || !canvasData || total <= 0) {
      return [{ snapshot: canvasData, durationSeconds: total }];
    }

    const params = this.resolveParams(board);
    const safeFps = fps || 24;
    const holdSeconds = params.holdFrames / safeFps;
    if (holdSeconds <= 0) {
      return [{ snapshot: canvasData, durationSeconds: total }];
    }

    const perturbed: Record<string, unknown>[] = [];
    for (let i = 0; i < params.variations; i++) {
      perturbed.push(this.perturbSnapshot(canvasData, this.seedFor(board.id, i), params));
    }

    const segments: BoilSegment[] = [];
    let elapsed = 0;
    let segIndex = 0;
    while (elapsed < total - 1e-6) {
      const durationSeconds = Math.min(holdSeconds, total - elapsed);
      segments.push({
        snapshot: perturbed[segIndex % perturbed.length],
        durationSeconds,
      });
      elapsed += durationSeconds;
      segIndex++;
    }

    return segments.length > 0 ? segments : [{ snapshot: canvasData, durationSeconds: total }];
  }

  private paramsSignature(params: BoilParams): string {
    return `${params.variations}:${params.holdFrames}:${params.amount}`;
  }

  private renderVariations(
    boardId: string,
    canvasData: Record<string, unknown> | null,
    backgroundColor: string,
    params: BoilParams
  ): string[] {
    const images: string[] = [];
    for (let i = 0; i < params.variations; i++) {
      const snapshot = canvasData
        ? this.perturbSnapshot(canvasData, this.seedFor(boardId, i), params)
        : null;
      const image = this.renderSnapshotToDataUrl(snapshot, backgroundColor);
      if (image) {
        images.push(image);
      }
    }
    return images;
  }

  private renderSnapshotToDataUrl(
    snapshot: Record<string, unknown> | null,
    backgroundColor: string
  ): string | null {
    const container = document.createElement('div');
    container.style.cssText =
      'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
    document.body.appendChild(container);

    let lc: LCInstance | null = null;
    let dataUrl: string | null = null;
    try {
      lc = LC.init(container, { imageURLPrefix: 'assets/lc-images' });
      lc.setImageSize(this.store.width(), this.store.height());
      if (snapshot) {
        lc.loadSnapshot(this.withoutViewportState(snapshot));
      } else {
        lc.repaintLayer('main');
      }
      lc.setColor('background', backgroundColor || '#ffffff');
      dataUrl = lc
        .getImage({
          scale: 1,
          includeWatermark: false,
          rect: { x: 0, y: 0, width: this.store.width(), height: this.store.height() },
        })
        .toDataURL('image/png');
    } catch {
      dataUrl = null;
    } finally {
      try {
        lc?.teardown();
      } catch {
        // ignore teardown errors
      }
      document.body.removeChild(container);
    }

    return dataUrl;
  }

  private withoutViewportState(snapshot: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...snapshot };
    delete (normalized as { position?: unknown }).position;
    delete (normalized as { scale?: unknown }).scale;
    delete (normalized as { imageSize?: unknown }).imageSize;
    return normalized;
  }

  private seedFor(boardId: string, variation: number): number {
    let hash = 2166136261 ^ (variation + 1);
    for (let i = 0; i < boardId.length; i++) {
      hash = Math.imul(hash ^ boardId.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Produce a copy of the snapshot with each shape nudged by a small, deterministic
   * jitter. The whole shape gets a coherent offset plus mild per-point noise so the
   * stroke wiggles without disintegrating.
   */
  private perturbSnapshot(
    snapshot: Record<string, unknown>,
    seed: number,
    params: BoilParams
  ): Record<string, unknown> {
    const serializableSnapshot = { ...snapshot };
    const imageReferences: { collection: string; index: number; image: unknown }[] = [];
    for (const collection of ['shapes', 'backgroundShapes']) {
      const shapes = snapshot[collection];
      if (!Array.isArray(shapes)) {
        continue;
      }
      serializableSnapshot[collection] = shapes.map((shape: unknown, index) => {
        if (!shape || typeof shape !== 'object' || !('data' in shape)) {
          return shape;
        }
        const data = shape.data;
        if (!data || typeof data !== 'object' || !('imageObject' in data)) {
          return shape;
        }
        const { imageObject, ...serializableData } = data;
        imageReferences.push({ collection, index, image: imageObject });
        return { ...shape, data: serializableData };
      });
    }

    const clone =
      typeof structuredClone === 'function'
        ? (structuredClone(serializableSnapshot) as Record<string, unknown>)
        : (JSON.parse(JSON.stringify(serializableSnapshot)) as Record<string, unknown>);

    for (const { collection, index, image } of imageReferences) {
      const shapes = clone[collection] as { data: Record<string, unknown> }[];
      shapes[index].data['imageObject'] = image;
    }

    const shapes = clone['shapes'];
    if (Array.isArray(shapes)) {
      shapes.forEach((shape, index) =>
        this.perturbShape(shape, seed + index * 2654435761, params)
      );
    }

    return clone;
  }

  private perturbShape(shape: unknown, seed: number, params: BoilParams): void {
    if (!shape || typeof shape !== 'object') {
      return;
    }

    const data = (shape as { data?: unknown }).data;
    if (!data || typeof data !== 'object') {
      return;
    }

    const rng = this.mulberry32(seed);
    const amount = params.amount;
    const offsetX = (rng() * 2 - 1) * amount;
    const offsetY = (rng() * 2 - 1) * amount;
    const noise = () => (rng() * 2 - 1) * amount * 0.5;

    const record = data as Record<string, unknown>;

    const jitterPairs = (value: unknown): void => {
      if (!Array.isArray(value)) {
        return;
      }
      for (const pair of value) {
        if (Array.isArray(pair) && pair.length >= 2) {
          pair[0] = (pair[0] as number) + offsetX + noise();
          pair[1] = (pair[1] as number) + offsetY + noise();
        }
      }
    };

    const jitterPoints = (value: unknown): void => {
      if (!Array.isArray(value)) {
        return;
      }
      for (const point of value) {
        if (point && typeof point === 'object' && 'x' in point && 'y' in point) {
          const p = point as { x: number; y: number };
          p.x = p.x + offsetX + noise();
          p.y = p.y + offsetY + noise();
        }
      }
    };

    // LinePath / Polygon control points. Only the raw control points are jittered;
    // the pre-baked smoothed points are dropped so LiterallyCanvas regenerates a
    // clean curve from the jittered controls. Jittering the dense smoothed points
    // directly produced sharp spikes at corners (where they cluster tightly).
    jitterPairs(record['pointCoordinatePairs']);
    jitterPoints(record['points']);
    delete record['smoothedPointCoordinatePairs'];
    delete record['smoothedPoints'];

    // Positioned shapes (Rectangle, Ellipse, Image, Text).
    if (typeof record['x'] === 'number' && typeof record['y'] === 'number') {
      record['x'] = (record['x'] as number) + offsetX;
      record['y'] = (record['y'] as number) + offsetY;
    }

    // Line endpoints.
    if (typeof record['x1'] === 'number' && typeof record['y1'] === 'number') {
      record['x1'] = (record['x1'] as number) + offsetX + noise();
      record['y1'] = (record['y1'] as number) + offsetY + noise();
    }
    if (typeof record['x2'] === 'number' && typeof record['y2'] === 'number') {
      record['x2'] = (record['x2'] as number) + offsetX + noise();
      record['y2'] = (record['y2'] as number) + offsetY + noise();
    }
  }

  private mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
