import { getShapeBounds } from './geometry';
import type { ShapeRegistry } from '../../literally-canvas-interfaces';

export function registerRotatableShapes(api: ShapeRegistry): void {
  for (const name of ['Rectangle', 'Ellipse']) {
    api.defineShape(name, {
      constructor(this: Record<string, unknown>, args: Record<string, unknown> = {}) {
        Object.assign(
          this,
          {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            strokeWidth: 1,
            strokeColor: 'black',
            fillColor: 'transparent',
            rotation: 0,
          },
          args
        );
      },
      getBoundingRect(this: Record<string, unknown>) {
        return getShapeBounds(this);
      },
      toJSON(this: Record<string, unknown>) {
        return Object.fromEntries(
          ['x', 'y', 'width', 'height', 'strokeWidth', 'strokeColor', 'fillColor', 'rotation'].map(
            (key) => [key, this[key]]
          )
        );
      },
      fromJSON(data: Record<string, unknown>) {
        return LC.createShape(name, data);
      },
      move(this: Record<string, number>, { xDiff = 0, yDiff = 0 } = {}) {
        this['x'] -= xDiff;
        this['y'] -= yDiff;
      },
      setUpperLeft(this: Record<string, number>, point: { x: number; y: number }) {
        this['x'] = point.x;
        this['y'] = point.y;
      },
    });
    api.defineCanvasRenderer(name, (ctx, shape) => {
      const x = shape['x'] as number;
      const y = shape['y'] as number;
      const width = shape['width'] as number;
      const height = shape['height'] as number;
      ctx.save();
      ctx.translate(x + width / 2, y + height / 2);
      ctx.rotate((shape['rotation'] as number) || 0);
      ctx.fillStyle = shape['fillColor'] as string;
      ctx.strokeStyle = shape['strokeColor'] as string;
      ctx.lineWidth = shape['strokeWidth'] as number;
      if (name === 'Rectangle') {
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.strokeRect(-width / 2, -height / 2, width, height);
      } else {
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}
