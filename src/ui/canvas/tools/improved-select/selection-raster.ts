import type { SelectionBounds } from './geometry';
import type { SelectionRegion } from './selection-state';
import { getShapeBounds } from './geometry';
import { renderShape } from './shape-hit-testing';

type Shape = Record<string, unknown>;

export function maskSelection(
  source: HTMLCanvasElement,
  bounds: SelectionBounds,
  region: SelectionRegion,
  keepInside: boolean
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a selection canvas.');
  context.drawImage(source, 0, 0);
  context.setTransform(canvas.width / bounds.width, 0, 0, canvas.height / bounds.height, 0, 0);
  context.globalCompositeOperation = keepInside ? 'destination-in' : 'destination-out';
  context.beginPath();
  const left = Math.min(region.start.x, region.end.x) - bounds.x;
  const top = Math.min(region.start.y, region.end.y) - bounds.y;
  const width = Math.abs(region.end.x - region.start.x);
  const height = Math.abs(region.end.y - region.start.y);
  if (region.mode === 'circle') {
    context.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else if ((region.mode === 'polygon' || region.mode === 'lasso') && region.path.length > 2) {
    context.moveTo(region.path[0].x - bounds.x, region.path[0].y - bounds.y);
    for (const point of region.path.slice(1))
      context.lineTo(point.x - bounds.x, point.y - bounds.y);
    context.closePath();
  } else {
    context.rect(left, top, width, height);
  }
  context.fill();
  context.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

export function imageShape(canvas: HTMLCanvasElement, bounds: SelectionBounds): Shape {
  Object.defineProperty(canvas, 'src', {
    get: () => canvas.toDataURL('image/png'),
    configurable: true,
  });
  return LC.createShape('Image', {
    x: bounds.x,
    y: bounds.y,
    image: canvas,
    cropWidth: canvas.width,
    cropHeight: canvas.height,
    scale: 1,
    scaleX: bounds.width / canvas.width,
    scaleY: bounds.height / canvas.height,
    rotation: 0,
  }) as Shape;
}

export function connectedImages(canvas: HTMLCanvasElement, bounds: SelectionBounds): Shape[] {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not inspect selected pixels.');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const visited = new Uint8Array(canvas.width * canvas.height);
  const queue = new Int32Array(visited.length);
  const shapes: Shape[] = [];
  for (let seed = 0; seed < visited.length; seed += 1) {
    if (visited[seed] || !pixels[seed * 4 + 3]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = seed;
    visited[seed] = 1;
    let left = canvas.width,
      top = canvas.height,
      right = -1,
      bottom = -1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % canvas.width,
        y = Math.floor(index / canvas.width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= canvas.width || ny >= canvas.height) continue;
          const next = ny * canvas.width + nx;
          if (visited[next] || !pixels[next * 4 + 3]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    const image = document.createElement('canvas');
    image.width = right - left + 1;
    image.height = bottom - top + 1;
    const cropped = image.getContext('2d');
    if (!cropped) throw new Error('Could not crop selected pixels.');
    const component = cropped.createImageData(image.width, image.height);
    for (let i = 0; i < tail; i += 1) {
      const index = queue[i],
        x = index % canvas.width,
        y = Math.floor(index / canvas.width);
      component.data.set(
        pixels.subarray(index * 4, index * 4 + 4),
        ((y - top) * image.width + x - left) * 4
      );
    }
    cropped.putImageData(component, 0, 0);
    shapes.push(
      imageShape(image, {
        x: bounds.x + (left * bounds.width) / canvas.width,
        y: bounds.y + (top * bounds.height) / canvas.height,
        width: (image.width * bounds.width) / canvas.width,
        height: (image.height * bounds.height) / canvas.height,
      })
    );
  }
  return shapes;
}

export function regionPieces(shape: Shape, region: SelectionRegion, inside = true): Shape[] {
  const bounds = getShapeBounds(shape);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return [];
  return connectedImages(maskSelection(renderShape(shape, bounds), bounds, region, inside), bounds);
}
