export type SelectionMode = 'rectangle' | 'circle' | 'polygon' | 'lasso';

export function pointInSelection(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  mode: SelectionMode,
  path: readonly { x: number; y: number }[],
): boolean {
  if (mode === 'circle') {
    const rx = Math.abs(end.x - start.x) / 2;
    const ry = Math.abs(end.y - start.y) / 2;
    if (rx === 0 || ry === 0) return false;
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    return ((point.x - cx) / rx) ** 2 + ((point.y - cy) / ry) ** 2 <= 1;
  }

  if (mode === 'polygon' || mode === 'lasso') {
    const points = path.length >= 3 ? path : polygonFromBounds(start, end);
    return pointInPolygon(point, points);
  }

  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
}

export function pointInPolygon(
  point: { x: number; y: number },
  vertices: readonly { x: number; y: number }[],
): boolean {
  if (vertices.length < 3) return false;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const a = vertices[i];
    const b = vertices[j];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonFromBounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number }[] {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  return [
    { x: (left + right) / 2, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}
