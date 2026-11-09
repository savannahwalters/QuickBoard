export interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getShapeBounds(shape: Record<string, unknown>): SelectionBounds | null {
  if (typeof shape['getBoundingRect'] !== 'function') return null;
  if (shape['className'] === 'Rectangle' || shape['className'] === 'Ellipse') {
    const x = shape['x'] as number;
    const y = shape['y'] as number;
    const width = shape['width'] as number;
    const height = shape['height'] as number;
    const stroke = (shape['strokeWidth'] as number) || 0;
    const rotation = (shape['rotation'] as number) || 0;
    if (rotation) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const rotatedWidth =
        shape['className'] === 'Ellipse'
          ? Math.hypot(width * cos, height * sin)
          : Math.abs(width * cos) + Math.abs(height * sin);
      const rotatedHeight =
        shape['className'] === 'Ellipse'
          ? Math.hypot(width * sin, height * cos)
          : Math.abs(width * sin) + Math.abs(height * cos);
      return {
        x: x + width / 2 - (rotatedWidth + stroke) / 2,
        y: y + height / 2 - (rotatedHeight + stroke) / 2,
        width: rotatedWidth + stroke,
        height: rotatedHeight + stroke,
      };
    }
    return {
      x: Math.min(x, x + width) - stroke / 2,
      y: Math.min(y, y + height) - stroke / 2,
      width: Math.abs(width) + stroke,
      height: Math.abs(height) + stroke,
    };
  }
  const bounds = (shape['getBoundingRect'] as () => SelectionBounds).call(shape);
  return {
    x: Math.min(bounds.x, bounds.x + bounds.width),
    y: Math.min(bounds.y, bounds.y + bounds.height),
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height),
  };
}

export function getSelectionBounds(shapes: readonly Record<string, unknown>[]): SelectionBounds {
  const bounds = shapes.flatMap((shape) => {
    const rect = getShapeBounds(shape);
    return rect ? [rect] : [];
  });
  if (!bounds.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...bounds.map((rect) => rect.x));
  const y = Math.min(...bounds.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...bounds.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...bounds.map((rect) => rect.y + rect.height)) - y,
  };
}

export function getGlobalPoint(shape: Record<string, unknown>, nx: number, ny: number) {
  const sw =
    ((shape['cropWidth'] as number) ||
      (shape['image'] ? (shape['image'] as HTMLImageElement).width : 0)) *
    (shape['scale'] as number) *
    ((shape['scaleX'] as number) || 1);
  const sh =
    ((shape['cropHeight'] as number) ||
      (shape['image'] ? (shape['image'] as HTMLImageElement).height : 0)) *
    (shape['scale'] as number) *
    ((shape['scaleY'] as number) || 1);
  const rot = (shape['rotation'] as number) || 0;
  const cx = (shape['x'] as number) + sw / 2;
  const cy = (shape['y'] as number) + sh / 2;
  const lx = (nx - 0.5) * sw;
  const ly = (ny - 0.5) * sh;
  return {
    x: cx + Math.cos(rot) * lx - Math.sin(rot) * ly,
    y: cy + Math.sin(rot) * lx + Math.cos(rot) * ly,
  };
}

export function setGlobalPointAnchor(
  shape: Record<string, unknown>,
  nx: number,
  ny: number,
  targetG: { x: number; y: number }
) {
  const sw =
    ((shape['cropWidth'] as number) ||
      (shape['image'] ? (shape['image'] as HTMLImageElement).width : 0)) *
    (shape['scale'] as number) *
    ((shape['scaleX'] as number) || 1);
  const sh =
    ((shape['cropHeight'] as number) ||
      (shape['image'] ? (shape['image'] as HTMLImageElement).height : 0)) *
    (shape['scale'] as number) *
    ((shape['scaleY'] as number) || 1);
  const rot = (shape['rotation'] as number) || 0;
  const lx = (nx - 0.5) * sw;
  const ly = (ny - 0.5) * sh;
  shape['x'] = targetG.x - sw / 2 - Math.cos(rot) * lx + Math.sin(rot) * ly;
  shape['y'] = targetG.y - sh / 2 - Math.sin(rot) * lx - Math.cos(rot) * ly;
}

export function ptToLocal(gx: number, gy: number, shape: Record<string, unknown>) {
  const sw =
    ((shape['cropWidth'] as number) ||
      (shape['image'] ? (shape['image'] as HTMLImageElement).width : 0)) *
    (shape['scale'] as number) *
    ((shape['scaleX'] as number) || 1);
  const sh =
    ((shape['cropHeight'] as number) ||
      (shape['image'] ? (shape['image'] as HTMLImageElement).height : 0)) *
    (shape['scale'] as number) *
    ((shape['scaleY'] as number) || 1);
  const dx = gx - ((shape['x'] as number) + sw / 2);
  const dy = gy - ((shape['y'] as number) + sh / 2);
  const rot = -((shape['rotation'] as number) || 0);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return { lx: dx * cos - dy * sin + sw / 2, ly: dx * sin + dy * cos + sh / 2, sw, sh };
}
