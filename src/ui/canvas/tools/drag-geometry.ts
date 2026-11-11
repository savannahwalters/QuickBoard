export interface DragPoint {
  x: number;
  y: number;
}

export function constrainSquare(start: DragPoint, end: DragPoint): DragPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + (dx < 0 ? -size : size),
    y: start.y + (dy < 0 ? -size : size),
  };
}
