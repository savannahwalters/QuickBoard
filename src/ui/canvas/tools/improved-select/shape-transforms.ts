import { getShapeBounds } from './geometry';
import { imageShape } from './selection-raster';
import { renderShape } from './shape-hit-testing';

export type ShapeSnapshots = ReadonlyMap<Record<string, unknown>, Record<string, unknown>>;
const nativeShapes = new Set([
  'Image',
  'Rectangle',
  'Ellipse',
  'Line',
  'LinePath',
  'ErasedLinePath',
  'Polygon',
  'Point',
]);

export function snapshotShapes(shapes: readonly Record<string, unknown>[]): ShapeSnapshots {
  return new Map(shapes.map((shape) => [shape, LC.shapeToJSON(shape)]));
}

export function restoreShapes(snapshots: ShapeSnapshots): void {
  for (const [shape, snapshot] of snapshots) {
    const restored = LC.JSONToShape(snapshot);
    if (!restored) throw new Error('Could not restore a selected shape.');
    for (const key of Object.keys(shape)) delete shape[key];
    Object.setPrototypeOf(shape, Object.getPrototypeOf(restored));
    Object.assign(shape, restored);
  }
}

export function prepareTransform(
  shape: Record<string, unknown>,
  operation: 'move' | 'transform' | 'stretch'
): void {
  const rotatedStretch = operation === 'stretch' && !!shape['rotation'];
  if (nativeShapes.has(shape['className'] as string) && !rotatedStretch) return;
  if (
    operation === 'move' &&
    (typeof shape['move'] === 'function' || typeof shape['setUpperLeft'] === 'function')
  )
    return;
  // Unknown renderers and rotated anisotropic stretches use an undoable image conversion,
  // rather than guessing at custom serialized fields or silently applying the wrong transform.
  const bounds = getShapeBounds(shape);
  if (!bounds) throw new Error(`Shape ${String(shape['className'])} has no selection bounds.`);
  const image = imageShape(renderShape(shape, bounds), bounds);
  const id = shape['id'];
  for (const key of Object.keys(shape)) delete shape[key];
  Object.setPrototypeOf(shape, Object.getPrototypeOf(image));
  Object.assign(shape, image, { id });
}

export function translateShapes(snapshots: ShapeSnapshots, dx: number, dy: number): void {
  for (const [shape, snapshot] of snapshots) {
    const data = snapshot['data'] as Record<string, unknown>;
    if (nativeShapes.has(snapshot['className'] as string)) {
      restoreShapes(
        new Map([
          [
            shape,
            {
              ...snapshot,
              data: mapCoordinates(data, (x, y) => ({
                x: x + dx,
                y: y + dy,
              })),
            },
          ],
        ])
      );
      continue;
    }
    restoreShapes(new Map([[shape, snapshot]]));
    if (typeof shape['move'] === 'function') {
      (shape['move'] as (delta: { xDiff: number; yDiff: number }) => void).call(shape, {
        xDiff: -dx,
        yDiff: -dy,
      });
    } else if (typeof shape['x'] === 'number' && typeof shape['y'] === 'number') {
      shape['x'] += dx;
      shape['y'] += dy;
    } else if (typeof shape['setUpperLeft'] === 'function') {
      const bounds = getShapeBounds(shape);
      if (!bounds) throw new Error('Cannot move a shape without bounds.');
      (shape['setUpperLeft'] as (point: { x: number; y: number }) => void).call(shape, {
        x: bounds.x + dx,
        y: bounds.y + dy,
      });
    } else {
      for (const key of ['x1', 'x2']) {
        if (typeof shape[key] === 'number') shape[key] += dx;
      }
      for (const key of ['y1', 'y2']) {
        if (typeof shape[key] === 'number') shape[key] += dy;
      }
    }
  }
}

function mapCoordinates(
  data: Record<string, unknown>,
  transform: (x: number, y: number) => { x: number; y: number }
): Record<string, unknown> {
  const next = { ...data };
  for (const [x, y] of [
    ['x', 'y'],
    ['x1', 'y1'],
    ['x2', 'y2'],
  ]) {
    if (typeof data[x] === 'number' && typeof data[y] === 'number') {
      const point = transform(data[x], data[y]);
      next[x] = point.x;
      next[y] = point.y;
    }
  }
  for (const key of ['pointCoordinatePairs', 'smoothedPointCoordinatePairs']) {
    if (Array.isArray(data[key]))
      next[key] = (data[key] as [number, number][]).map(([x, y]) => {
        const point = transform(x, y);
        return [point.x, point.y];
      });
  }
  if (Array.isArray(data['points']))
    next['points'] = (data['points'] as Record<string, unknown>[]).map((point) =>
      point['data']
        ? { ...point, data: mapCoordinates(point['data'] as Record<string, unknown>, transform) }
        : mapCoordinates(point, transform)
    );
  return next;
}

export function rotateShapes(
  snapshots: ShapeSnapshots,
  center: { x: number; y: number },
  angle: number
): void {
  const rotatePoint = (x: number, y: number) => ({
    x: center.x + (x - center.x) * Math.cos(angle) - (y - center.y) * Math.sin(angle),
    y: center.y + (x - center.x) * Math.sin(angle) + (y - center.y) * Math.cos(angle),
  });
  restoreShapes(
    new Map(
      [...snapshots].map(([shape, snapshot]) => {
        const data = snapshot['data'] as Record<string, unknown>;
        const next = mapCoordinates(data, rotatePoint);
        if (['Image', 'Rectangle', 'Ellipse'].includes(snapshot['className'] as string)) {
          const image = data['imageObject'] as HTMLImageElement | undefined;
          const width =
            snapshot['className'] === 'Image'
              ? ((data['cropWidth'] as number) || image?.width || 0) *
                ((data['scale'] as number) || 1) *
                ((data['scaleX'] as number) || 1)
              : (data['width'] as number);
          const height =
            snapshot['className'] === 'Image'
              ? ((data['cropHeight'] as number) || image?.height || 0) *
                ((data['scale'] as number) || 1) *
                ((data['scaleY'] as number) || 1)
              : (data['height'] as number);
          const position = rotatePoint(
            (data['x'] as number) + width / 2,
            (data['y'] as number) + height / 2
          );
          next['x'] = position.x - width / 2;
          next['y'] = position.y - height / 2;
          next['rotation'] = ((data['rotation'] as number) || 0) + angle;
        }
        return [shape, { ...snapshot, data: next }];
      })
    )
  );
}

export function resizeShapes(
  snapshots: ShapeSnapshots,
  anchor: { x: number; y: number },
  scaleX: number,
  scaleY: number
): void {
  const transformData = (data: Record<string, unknown>): Record<string, unknown> => {
    const next = mapCoordinates(data, (x, y) => ({
      x: anchor.x + (x - anchor.x) * scaleX,
      y: anchor.y + (y - anchor.y) * scaleY,
    }));
    for (const key of ['width', 'forcedWidth', 'scaleX']) {
      if (typeof data[key] === 'number') next[key] = data[key] * scaleX;
    }
    for (const key of ['height', 'forcedHeight', 'scaleY']) {
      if (typeof data[key] === 'number') next[key] = data[key] * scaleY;
    }
    for (const key of ['size', 'pointSize', 'strokeWidth']) {
      if (typeof data[key] === 'number') next[key] = data[key] * Math.min(scaleX, scaleY);
    }
    if (Array.isArray(data['points'])) {
      next['points'] = (data['points'] as Record<string, unknown>[]).map((point) =>
        point['data']
          ? { ...point, data: transformData(point['data'] as Record<string, unknown>) }
          : transformData(point)
      );
    }
    if (typeof data['font'] === 'string') {
      next['font'] = data['font'].replace(
        /([\d.]+)px/,
        (_match, size: string) => `${Number(size) * Math.min(scaleX, scaleY)}px`
      );
    }
    return next;
  };
  const resized = new Map(
    [...snapshots].map(([shape, snapshot]) => [
      shape,
      { ...snapshot, data: transformData(snapshot['data'] as Record<string, unknown>) },
    ])
  );
  restoreShapes(resized);
}
