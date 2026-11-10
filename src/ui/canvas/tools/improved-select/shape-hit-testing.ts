import { getShapeBounds, type SelectionBounds } from './geometry';
import { pointInSelection, type SelectionMode } from './selection-geometry';

type Shape = Record<string, unknown>;
interface Raster {
  bounds: SelectionBounds;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  contentBounds?: SelectionBounds;
}

export function renderShape(shape: Shape, bounds: SelectionBounds): HTMLCanvasElement {
  if (!LC.renderSnapshotToImage) throw new Error('LiterallyCanvas image rendering is unavailable.');
  const canvas = LC.renderSnapshotToImage(
    {
      shapes: [LC.shapeToJSON(shape)],
      backgroundShapes: [],
      colors: { background: 'transparent' },
      imageSize: { width: 'infinite', height: 'infinite' },
    },
    { rect: { ...bounds }, scale: 1, includeWatermark: false }
  );
  if (!canvas) throw new Error(`Could not render ${String(shape['className'])} for selection.`);
  return canvas;
}

/** Uses the registered renderer, not shape names or opaque bounding boxes. */
export class ShapeHitTesting {
  private cache = new WeakMap<Shape, Raster>();

  clear(): void {
    this.cache = new WeakMap();
  }

  private raster(shape: Shape): Raster | null {
    const image = shape['image'];
    if (image instanceof HTMLImageElement && (!image.complete || !image.naturalWidth)) return null;
    const cached = this.cache.get(shape);
    if (cached) return cached;
    const bounds = getShapeBounds(shape);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const canvas = renderShape(shape, bounds);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not inspect a shape for selection.');
    const raster = {
      bounds,
      width: canvas.width,
      height: canvas.height,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
    };
    this.cache.set(shape, raster);
    return raster;
  }

  visibleBounds(shape: Shape): SelectionBounds | null {
    const raster = this.raster(shape);
    if (!raster) return null;
    if (raster.contentBounds) return raster.contentBounds;
    let left = raster.width,
      top = raster.height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < raster.height; y += 1) {
      for (let x = 0; x < raster.width; x += 1) {
        if (!raster.pixels[(y * raster.width + x) * 4 + 3]) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left) return null;
    const { bounds } = raster;
    raster.contentBounds = {
      x: bounds.x + (left * bounds.width) / raster.width,
      y: bounds.y + (top * bounds.height) / raster.height,
      width: ((right - left + 1) * bounds.width) / raster.width,
      height: ((bottom - top + 1) * bounds.height) / raster.height,
    };
    return raster.contentBounds;
  }

  hit(shapes: readonly Shape[], point: { x: number; y: number }, tolerance: number): Shape | null {
    for (let index = shapes.length - 1; index >= 0; index -= 1) {
      const shape = shapes[index];
      const bounds = getShapeBounds(shape);
      if (
        !bounds ||
        point.x < bounds.x - tolerance ||
        point.x > bounds.x + bounds.width + tolerance ||
        point.y < bounds.y - tolerance ||
        point.y > bounds.y + bounds.height + tolerance
      )
        continue;
      const raster = this.raster(shape);
      if (!raster) continue;
      const sx = raster.width / bounds.width;
      const sy = raster.height / bounds.height;
      const left = Math.max(0, Math.floor((point.x - tolerance - bounds.x) * sx));
      const right = Math.min(raster.width - 1, Math.ceil((point.x + tolerance - bounds.x) * sx));
      const top = Math.max(0, Math.floor((point.y - tolerance - bounds.y) * sy));
      const bottom = Math.min(raster.height - 1, Math.ceil((point.y + tolerance - bounds.y) * sy));
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          if (raster.pixels[(y * raster.width + x) * 4 + 3]) return shape;
        }
      }
    }
    return null;
  }

  intersects(
    shape: Shape,
    start: { x: number; y: number },
    end: { x: number; y: number },
    mode: SelectionMode,
    path: readonly { x: number; y: number }[]
  ): boolean {
    const raster = this.raster(shape);
    if (!raster) return false;
    const { bounds, width, height, pixels } = raster;
    const left = Math.max(
      0,
      Math.floor(((Math.min(start.x, end.x) - bounds.x) * width) / bounds.width)
    );
    const right = Math.min(
      width,
      Math.ceil(((Math.max(start.x, end.x) - bounds.x) * width) / bounds.width)
    );
    const top = Math.max(
      0,
      Math.floor(((Math.min(start.y, end.y) - bounds.y) * height) / bounds.height)
    );
    const bottom = Math.min(
      height,
      Math.ceil(((Math.max(start.y, end.y) - bounds.y) * height) / bounds.height)
    );
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        if (
          pixels[(y * width + x) * 4 + 3] &&
          pointInSelection(
            {
              x: bounds.x + ((x + 0.5) * bounds.width) / width,
              y: bounds.y + ((y + 0.5) * bounds.height) / height,
            },
            start,
            end,
            mode,
            path
          )
        )
          return true;
      }
    }
    return false;
  }
}
