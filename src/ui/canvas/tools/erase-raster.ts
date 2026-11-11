import type { SelectionBounds } from './improved-select/geometry';

export interface EraserPoint {
  x: number;
  y: number;
}

export function eraserBounds(
  start: EraserPoint,
  end: EraserPoint,
  diameter: number
): SelectionBounds {
  return {
    x: Math.min(start.x, end.x) - diameter / 2,
    y: Math.min(start.y, end.y) - diameter / 2,
    width: Math.abs(end.x - start.x) + diameter,
    height: Math.abs(end.y - start.y) + diameter,
  };
}

/** Cuts a continuous round stroke, reporting only actual alpha changes. */
export function eraseRaster(
  canvas: HTMLCanvasElement,
  bounds: SelectionBounds,
  start: EraserPoint,
  end: EraserPoint,
  diameter: number
): boolean {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not erase canvas pixels.');
  const sx = canvas.width / bounds.width;
  const sy = canvas.height / bounds.height;
  const stroke = eraserBounds(start, end, diameter);
  const left = Math.max(0, Math.floor((stroke.x - bounds.x) * sx) - 1);
  const top = Math.max(0, Math.floor((stroke.y - bounds.y) * sy) - 1);
  const right = Math.min(canvas.width, Math.ceil((stroke.x + stroke.width - bounds.x) * sx) + 1);
  const bottom = Math.min(canvas.height, Math.ceil((stroke.y + stroke.height - bounds.y) * sy) + 1);
  if (right <= left || bottom <= top) return false;
  const before = context.getImageData(left, top, right - left, bottom - top).data;
  context.save();
  context.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy);
  context.globalCompositeOperation = 'destination-out';
  context.fillStyle = '#000000';
  context.strokeStyle = '#000000';
  context.lineWidth = diameter;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (start.x === end.x && start.y === end.y) {
    context.arc(start.x, start.y, diameter / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }
  context.restore();
  const after = context.getImageData(left, top, right - left, bottom - top).data;
  for (let index = 3; index < before.length; index += 4) {
    if (before[index] !== after[index]) return true;
  }
  return false;
}
