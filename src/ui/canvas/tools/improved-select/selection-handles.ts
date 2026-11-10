import type { SelectionBounds } from './geometry';
import { selectionColors } from './selection-style';

export type GroupHandle =
  | 'group-tl'
  | 'group-tr'
  | 'group-bl'
  | 'group-br'
  | 'group-t'
  | 'group-b'
  | 'group-l'
  | 'group-r'
  | 'group-rotate';

export function selectionHandles(bounds: SelectionBounds, unit = 1) {
  const { x, y, width, height } = bounds;
  return [
    { x: x + width / 2, y: y - 25 * unit, mode: 'group-rotate' },
    { x, y, mode: 'group-tl' },
    { x: x + width, y, mode: 'group-tr' },
    { x, y: y + height, mode: 'group-bl' },
    { x: x + width, y: y + height, mode: 'group-br' },
    { x: x + width / 2, y, mode: 'group-t' },
    { x: x + width / 2, y: y + height, mode: 'group-b' },
    { x, y: y + height / 2, mode: 'group-l' },
    { x: x + width, y: y + height / 2, mode: 'group-r' },
  ] satisfies { x: number; y: number; mode: GroupHandle }[];
}

export function hitSelectionHandle(
  bounds: SelectionBounds,
  point: { x: number; y: number },
  unit = 1
): GroupHandle | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  let closest: GroupHandle | null = null;
  let distance = 10 * unit;
  for (const handle of selectionHandles(bounds, unit)) {
    const candidate = Math.hypot(point.x - handle.x, point.y - handle.y);
    if (candidate < distance) {
      closest = handle.mode;
      distance = candidate;
    }
  }
  return closest;
}

export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  bounds: SelectionBounds,
  unit = 1
): void {
  const { x, y, width, height } = bounds;
  const colors = selectionColors();
  ctx.save();
  ctx.lineWidth = unit;
  ctx.setLineDash([2 * unit, 3 * unit]);
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(x, y, width, height);
  ctx.lineDashOffset = 2.5 * unit;
  ctx.strokeStyle = colors.border;
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x + width / 2, y);
  ctx.lineTo(x + width / 2, y - 25 * unit);
  ctx.stroke();
  ctx.fillStyle = colors.handle;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5 * unit;
  for (const handle of selectionHandles(bounds, unit)) {
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, (handle.mode === 'group-rotate' ? 5 : 4) * unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
