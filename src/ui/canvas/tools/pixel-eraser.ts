import type { LCInstance, LCTool } from '../literally-canvas-interfaces';
import { eraseRaster, eraserBounds, type EraserPoint } from './erase-raster';
import { getShapeBounds, type SelectionBounds } from './improved-select/geometry';
import {
  captureSelection,
  SelectionAction,
  type SelectionSnapshot,
} from './improved-select/selection-action';
import { bakeLegacyMasks, connectedImages, imageShape } from './improved-select/selection-raster';
import { getSelection, getSelectionRegion } from './improved-select/selection-state';
import { renderShape } from './improved-select/shape-hit-testing';

type Shape = Record<string, unknown>;
interface EraserRaster {
  bounds: SelectionBounds;
  canvas: HTMLCanvasElement;
  preview: Shape | null;
}

export class PixelEraser implements LCTool {
  name = 'Eraser';
  iconName = 'eraser';
  strokeWidth = 5;
  optionsStyle = 'stroke-width';
  usesSimpleAPI = true;

  private before: SelectionSnapshot | null = null;
  private previous: EraserPoint | null = null;
  private readonly rasters = new Map<unknown, EraserRaster>();
  private baked: ReturnType<typeof bakeLegacyMasks> | null = null;

  constructor(private readonly lc: LCInstance, private readonly beforeErase?: () => void) {}

  didBecomeActive(): void {
    this.lc.setShapesInProgress([]);
    this.lc.canvas.style.cursor = 'default';
  }

  begin(x: number, y: number): void {
    this.finish();
    this.beforeErase?.();
    this.before = captureSelection(this.lc, getSelection(this.lc), getSelectionRegion(this.lc));
    this.previous = { x, y };
    this.erase(this.previous, this.previous);
  }

  ['continue'](x: number, y: number): void {
    const point = { x, y };
    if (!this.previous || (x === this.previous.x && y === this.previous.y)) return;
    this.erase(this.previous, point);
    this.previous = point;
  }

  end(x: number, y: number): void {
    this.continue(x, y);
    this.finish();
  }

  willBecomeInactive(): void {
    this.finish();
  }

  private erase(start: EraserPoint, end: EraserPoint): void {
    if (!this.before) return;
    const stroke = eraserBounds(start, end, this.strokeWidth);
    let changed = false;
    for (const original of this.before.shapes) {
      if (!original || typeof original !== 'object') continue;
      const shape = original as Shape;
      if (shape['className'] === 'ErasedLinePath') continue;
      const bounds = this.rasters.get(original)?.bounds ?? getShapeBounds(shape);
      if (
        !bounds ||
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        bounds.x > stroke.x + stroke.width ||
        bounds.y > stroke.y + stroke.height ||
        bounds.x + bounds.width < stroke.x ||
        bounds.y + bounds.height < stroke.y
      )
        continue;
      const image = shape['image'];
      if (image instanceof HTMLImageElement && (!image.complete || !image.naturalWidth)) continue;
      let raster = this.rasters.get(original);
      if (!raster) {
        const aligned = {
          x: Math.floor(bounds.x),
          y: Math.floor(bounds.y),
          width: Math.ceil(bounds.x + bounds.width) - Math.floor(bounds.x),
          height: Math.ceil(bounds.y + bounds.height) - Math.floor(bounds.y),
        };
        raster = {
          bounds: aligned,
          canvas: renderShape(shape, aligned, this.before.shapes),
          preview: null,
        };
        this.rasters.set(original, raster);
      }
      this.baked ??= bakeLegacyMasks(this.before.shapes);
      if (!eraseRaster(raster.canvas, raster.bounds, start, end, this.strokeWidth)) continue;
      raster.preview ??= imageShape(raster.canvas, raster.bounds, true);
      changed = true;
    }
    if (changed) {
      const baked = this.baked;
      this.lc.shapes.splice(
        0,
        this.lc.shapes.length,
        ...this.before.shapes.flatMap((original) => {
          const shape = original as Shape;
          if (shape['className'] === 'ErasedLinePath') return [];
          return [this.rasters.get(shape)?.preview ?? baked?.replacements.get(shape) ?? shape];
        })
      );
      this.lc.repaintLayer('main');
    }
  }

  private finish(): void {
    const before = this.before;
    if (!before) return;
    const changed = [...this.rasters.values()].some((raster) => raster.preview);
    if (changed) {
      const shapes = before.shapes.flatMap((shape) => {
        if ((shape as Shape)['className'] === 'ErasedLinePath') return [];
        const raster = this.rasters.get(shape);
        return raster?.preview
          ? connectedImages(raster.canvas, raster.bounds)
          : [this.baked?.replacements.get(shape as Shape) ?? shape];
      });
      this.lc.shapes.splice(0, this.lc.shapes.length, ...shapes);
      this.lc.execute(new SelectionAction(this.lc, before, captureSelection(this.lc, [], null)));
    }
    this.before = null;
    this.previous = null;
    this.rasters.clear();
    this.baked = null;
    if (changed) this.lc.trigger('drawingChange', {});
  }
}
