import type { LCInstance } from '../../literally-canvas-interfaces';

export type ShapeSnapshots = ReadonlyMap<Record<string, unknown>, Record<string, unknown>>;

export function snapshotShapes(shapes: readonly Record<string, unknown>[]): ShapeSnapshots {
  return new Map(shapes.map((shape) => [shape, LC.shapeToJSON(shape)]));
}

export function restoreShapes(snapshots: ShapeSnapshots): void {
  for (const [shape, snapshot] of snapshots) {
    const restored = LC.JSONToShape(snapshot);
    if (!restored) throw new Error('Could not restore a selected shape.');
    for (const key of Object.keys(shape)) delete shape[key];
    Object.assign(shape, restored);
  }
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
  const rotateData = (data: Record<string, unknown>): Record<string, unknown> => {
    const next = { ...data };
    for (const [x, y] of [
      ['x', 'y'],
      ['x1', 'y1'],
      ['x2', 'y2'],
    ]) {
      if (typeof data[x] === 'number' && typeof data[y] === 'number') {
        const point = rotatePoint(data[x], data[y]);
        next[x] = point.x;
        next[y] = point.y;
      }
    }
    for (const key of ['pointCoordinatePairs', 'smoothedPointCoordinatePairs']) {
      if (Array.isArray(data[key])) {
        next[key] = (data[key] as [number, number][]).map(([x, y]) => {
          const point = rotatePoint(x, y);
          return [point.x, point.y];
        });
      }
    }
    if (Array.isArray(data['points'])) {
      next['points'] = (data['points'] as Record<string, unknown>[]).map((point) =>
        point['data']
          ? { ...point, data: rotateData(point['data'] as Record<string, unknown>) }
          : rotateData(point)
      );
    }
    return next;
  };
  restoreShapes(
    new Map(
      [...snapshots].map(([shape, snapshot]) => {
        const data = snapshot['data'] as Record<string, unknown>;
        const next = rotateData(data);
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
    const next = { ...data };
    for (const key of ['x', 'x1', 'x2']) {
      if (typeof data[key] === 'number') next[key] = anchor.x + (data[key] - anchor.x) * scaleX;
    }
    for (const key of ['y', 'y1', 'y2']) {
      if (typeof data[key] === 'number') next[key] = anchor.y + (data[key] - anchor.y) * scaleY;
    }
    for (const key of ['width', 'forcedWidth', 'scaleX']) {
      if (typeof data[key] === 'number') next[key] = data[key] * scaleX;
    }
    for (const key of ['height', 'forcedHeight', 'scaleY']) {
      if (typeof data[key] === 'number') next[key] = data[key] * scaleY;
    }
    for (const key of ['size', 'pointSize', 'strokeWidth']) {
      if (typeof data[key] === 'number') next[key] = data[key] * Math.min(scaleX, scaleY);
    }
    for (const key of ['pointCoordinatePairs', 'smoothedPointCoordinatePairs']) {
      if (Array.isArray(data[key])) {
        next[key] = (data[key] as [number, number][]).map(([x, y]) => [
          anchor.x + (x - anchor.x) * scaleX,
          anchor.y + (y - anchor.y) * scaleY,
        ]);
      }
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

export class ResizeAction {
  constructor(
    private readonly lc: LCInstance,
    private readonly before: ShapeSnapshots,
    private readonly after: ShapeSnapshots
  ) {}

  do(): void {
    restoreShapes(this.after);
    this.lc.repaintLayer('main');
  }

  undo(): void {
    restoreShapes(this.before);
    this.lc.repaintLayer('main');
  }
}
