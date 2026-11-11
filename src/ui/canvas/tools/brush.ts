import { LCInstance } from '../literally-canvas-interfaces';

interface Point {
  x: number;
  y: number;
  size: number;
  color: string;
}

interface LinePathLikeShape {
  points: Point[];
  spacing?: number;
  addPoint(point: Point): void;
  getBoundingRect?(): { x: number; y: number; width: number; height: number };
  move?(moveInfo?: { xDiff?: number; yDiff?: number }): void;
  setUpperLeft?(position: { x: number; y: number }): void;
}

interface ExtendedLCAPI {
  createShape: (type: string, args?: Record<string, unknown>) => unknown;
  defineShape?: (name: string, props: Record<string, unknown>) => void;
  defineCanvasRenderer?: (
    name: string,
    draw: (ctx: CanvasRenderingContext2D, shape: LinePathLikeShape) => void,
    drawLatest?: (
      ctx: CanvasRenderingContext2D,
      bufferCtx: CanvasRenderingContext2D,
      shape: LinePathLikeShape
    ) => void
  ) => void;
  defineSVGRenderer?: (name: string, draw: (shape: LinePathLikeShape) => string) => void;
}

const SQUARE_LINE_PATH_CLASS = 'SquareLinePath';

let squareBrushShapeRegistered = false;

function getExtendedLCAPI(): ExtendedLCAPI {
  return LC as unknown as ExtendedLCAPI;
}

function drawSquareLinePath(ctx: CanvasRenderingContext2D, shape: LinePathLikeShape): void {
  const points = shape.points;
  if (!points || points.length === 0) {
    return;
  }

  const spacingRatio = Math.max(0.1, (shape.spacing ?? 45) / 100);

  const stampSquare = (x: number, y: number, size: number, color: string): void => {
    const squareSize = Math.max(1, size);
    const half = squareSize / 2;
    const px = Math.round(x - half);
    const py = Math.round(y - half);
    ctx.fillStyle = color;
    ctx.fillRect(px, py, squareSize, squareSize);
  };

  stampSquare(points[0].x, points[0].y, points[0].size, points[0].color);

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const avgSize = (Math.max(1, a.size) + Math.max(1, b.size)) / 2;
    const stepDistance = Math.max(1, avgSize * spacingRatio);
    const steps = Math.max(1, Math.ceil(distance / stepDistance));

    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const size = a.size + (b.size - a.size) * t;
      const color = t < 0.5 ? a.color : b.color;
      stampSquare(a.x + dx * t, a.y + dy * t, size, color);
    }
  }
}

export function ensureSquareBrushShapeRegistered(): void {
  if (squareBrushShapeRegistered) {
    return;
  }

  const lcAPI = getExtendedLCAPI();
  if (!lcAPI.defineShape || !lcAPI.defineCanvasRenderer || !lcAPI.defineSVGRenderer) {
    return;
  }

  lcAPI.defineShape(SQUARE_LINE_PATH_CLASS, {
    constructor(this: LinePathLikeShape, args?: { points?: Point[]; spacing?: number }) {
      this.points = args?.points ?? [];
      this.spacing = args?.spacing ?? 45;
    },
    addPoint(this: LinePathLikeShape, point: Point) {
      this.points.push(point);
    },
    move(this: LinePathLikeShape, moveInfo: { xDiff?: number; yDiff?: number } = {}) {
      for (const point of this.points) {
        point.x -= moveInfo.xDiff ?? 0;
        point.y -= moveInfo.yDiff ?? 0;
      }
    },
    setUpperLeft(this: LinePathLikeShape, position: { x: number; y: number }) {
      const bounds = this.getBoundingRect?.();
      if (!bounds) return;
      this.move?.({
        xDiff: bounds.x - position.x,
        yDiff: bounds.y - position.y,
      });
    },
    getBoundingRect(this: LinePathLikeShape) {
      if (this.points.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }

      let left = Number.POSITIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;

      for (const point of this.points) {
        const half = point.size / 2;
        left = Math.min(left, point.x - half);
        top = Math.min(top, point.y - half);
        right = Math.max(right, point.x + half);
        bottom = Math.max(bottom, point.y + half);
      }

      return { x: left, y: top, width: right - left, height: bottom - top };
    },
    toJSON(this: LinePathLikeShape) {
      const points = this.points ?? [];
      if (points.length === 0) {
        return { points: [] };
      }

      const first = points[0];
      const sharedStyle = points.every(
        (point) => point.size === first.size && point.color === first.color
      );

      if (sharedStyle) {
        return {
          pointCoordinatePairs: points.map((point) => [point.x, point.y]),
          pointSize: first.size,
          pointColor: first.color,
          spacing: this.spacing ?? 45,
        };
      }

      return {
        spacing: this.spacing ?? 45,
        points: points.map((point) => ({
          className: 'Point',
          data: {
            x: point.x,
            y: point.y,
            size: point.size,
            color: point.color,
          },
        })),
      };
    },
    fromJSON(data: {
      points?: { data?: Point }[];
      pointCoordinatePairs?: [number, number][];
      pointSize?: number;
      pointColor?: string;
      spacing?: number;
    }) {
      const points = data.points
        ? data.points
            .map((pointJSON) => pointJSON.data)
            .filter((point): point is Point => Boolean(point))
        : (data.pointCoordinatePairs ?? []).map(([x, y]) => ({
            x,
            y,
            size: data.pointSize ?? 1,
            color: data.pointColor ?? '#000000',
          }));

      return lcAPI.createShape(SQUARE_LINE_PATH_CLASS, {
        points,
        spacing: data.spacing ?? 45,
      });
    },
  });

  lcAPI.defineCanvasRenderer(
    SQUARE_LINE_PATH_CLASS,
    drawSquareLinePath,
    (_ctx, bufferCtx, shape) => {
      drawSquareLinePath(bufferCtx, shape);
    }
  );

  lcAPI.defineSVGRenderer(SQUARE_LINE_PATH_CLASS, (shape) => {
    const points = shape.points;
    if (!points || points.length === 0) {
      return '<g />';
    }

    if (points.length === 1) {
      const size = Math.max(1, points[0].size);
      const half = size / 2;
      return `<rect x='${points[0].x - half}' y='${
        points[0].y - half
      }' width='${size}' height='${size}' fill='${points[0].color}' />`;
    }

    const segments = [] as string[];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      segments.push(
        `<line x1='${a.x}' y1='${a.y}' x2='${b.x}' y2='${b.y}' stroke='${
          a.color
        }' stroke-width='${Math.max(1, a.size)}' stroke-linecap='square' stroke-linejoin='miter' />`
      );
    }

    const last = points[points.length - 1];
    const lastSize = Math.max(1, last.size);
    const lastHalf = lastSize / 2;
    segments.push(
      `<rect x='${last.x - lastHalf}' y='${
        last.y - lastHalf
      }' width='${lastSize}' height='${lastSize}' fill='${last.color}' />`
    );

    return `<g>${segments.join('')}</g>`;
  });

  squareBrushShapeRegistered = true;
}

// Brush Tool - draws stroke objects that render as square stamps.
export class Brush {
  name = 'Brush';
  iconName = 'brush';
  strokeWidth = 5;
  optionsStyle = 'stroke-width';
  usesSimpleAPI = true;
  eventTimeThreshold = 10;
  spacing = 45;

  private currentShape: LinePathLikeShape | null = null;
  private color = '#000000';
  private lastEventTime = 0;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_lc: LCInstance) {
    ensureSquareBrushShapeRegistered();
  }

  willBecomeActive(): void {
    // Called before the tool becomes active
  }

  didBecomeActive(): void {
    // Called after the tool becomes active
  }

  willBecomeInactive(): void {
    // Called before the tool becomes inactive
  }

  didBecomeInactive(): void {
    // Called after the tool becomes inactive
  }

  begin(x: number, y: number, lc: LCInstance): void {
    this.strokeWidth = lc.tool.strokeWidth || 10;
    this.color = lc.getColor('primary');
    ensureSquareBrushShapeRegistered();

    this.currentShape = this.makeShape();
    this.currentShape.addPoint(this.makePoint(x, y));
    this.drawShapeInProgress(lc);
    this.lastEventTime = Date.now();
  }

  ['continue'](x: number, y: number, lc: LCInstance): void {
    if (!this.currentShape) {
      return;
    }

    const timeDiff = Date.now() - this.lastEventTime;
    if (timeDiff <= this.eventTimeThreshold) {
      return;
    }

    this.lastEventTime += timeDiff;
    this.currentShape.addPoint(this.makePoint(x, y));
    this.drawShapeInProgress(lc);
  }

  end(x: number, y: number, lc: LCInstance): void {
    if (!this.currentShape) {
      return;
    }

    this.currentShape.addPoint(this.makePoint(x, y));
    lc.saveShape(this.currentShape);
    lc.setShapesInProgress([]);
    this.currentShape = null;
  }

  private makePoint(x: number, y: number): Point {
    return LC.createShape('Point', {
      x,
      y,
      size: this.strokeWidth,
      color: this.color,
    }) as unknown as Point;
  }

  private makeShape(): LinePathLikeShape {
    if (squareBrushShapeRegistered) {
      return LC.createShape(SQUARE_LINE_PATH_CLASS, {
        spacing: this.spacing,
      }) as unknown as LinePathLikeShape;
    }

    // Fallback path if custom shape APIs are unavailable.
    return LC.createShape('LinePath', { smooth: false }) as unknown as LinePathLikeShape;
  }

  private drawShapeInProgress(lc: LCInstance): void {
    const typedLC = lc as LCInstance & {
      drawShapeInProgress?: (shape: unknown) => void;
    };

    if (typedLC.drawShapeInProgress && this.currentShape) {
      typedLC.drawShapeInProgress(this.currentShape);
      return;
    }

    if (this.currentShape) {
      lc.setShapesInProgress([this.currentShape]);
      lc.repaintLayer('main');
    }
  }
}
