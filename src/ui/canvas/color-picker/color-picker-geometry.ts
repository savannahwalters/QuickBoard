export interface PickerPoint {
  x: number;
  y: number;
}

export function hsvToRgb(
  hue: number,
  saturation: number,
  value: number
): { r: number; g: number; b: number } {
  const channel = (offset: number) => {
    const sector = (offset + (((hue % 360) + 360) % 360) / 60) % 6;
    return Math.round(
      255 * value * (1 - saturation * Math.max(0, Math.min(sector, 4 - sector, 1)))
    );
  };
  return { r: channel(5), g: channel(3), b: channel(1) };
}

export const TRIANGLE = {
  hue: { x: 0.5, y: 0.084308 },
  white: { x: 0.02, y: 0.915692 },
  black: { x: 0.98, y: 0.915692 },
};

export function trianglePoint(saturation: number, value: number): PickerPoint {
  const hueWeight = saturation * value;
  const whiteWeight = (1 - saturation) * value;
  const blackWeight = 1 - value;
  return {
    x: TRIANGLE.hue.x * hueWeight + TRIANGLE.white.x * whiteWeight + TRIANGLE.black.x * blackWeight,
    y: TRIANGLE.hue.y * hueWeight + TRIANGLE.white.y * whiteWeight + TRIANGLE.black.y * blackWeight,
  };
}

export function triangleColor(point: PickerPoint, project = true): { s: number; v: number } | null {
  let hueWeight = (TRIANGLE.white.y - point.y) / (TRIANGLE.white.y - TRIANGLE.hue.y);
  let blackWeight =
    (point.x - TRIANGLE.white.x - hueWeight * (TRIANGLE.hue.x - TRIANGLE.white.x)) /
    (TRIANGLE.black.x - TRIANGLE.white.x);
  let whiteWeight = 1 - hueWeight - blackWeight;
  if (Math.min(hueWeight, whiteWeight, blackWeight) < -0.000001) {
    if (!project) return null;
    const vertices = [TRIANGLE.hue, TRIANGLE.white, TRIANGLE.black];
    const candidates = vertices.map((start, index) => {
      const end = vertices[(index + 1) % vertices.length];
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const fraction = Math.max(
        0,
        Math.min(
          1,
          ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
            (deltaX * deltaX + deltaY * deltaY)
        )
      );
      return { x: start.x + deltaX * fraction, y: start.y + deltaY * fraction };
    });
    candidates.sort(
      (first, second) =>
        Math.hypot(first.x - point.x, first.y - point.y) -
        Math.hypot(second.x - point.x, second.y - point.y)
    );
    return triangleColor(candidates[0], false);
  }
  hueWeight = Math.max(0, hueWeight);
  whiteWeight = Math.max(0, whiteWeight);
  blackWeight = Math.max(0, blackWeight);
  const value = Math.min(1, hueWeight + whiteWeight);
  return { s: value > 0.000001 ? Math.min(1, hueWeight / value) : 0, v: value };
}

export function wheelColor(point: PickerPoint): { h: number; s: number } {
  const deltaX = point.x - 0.5;
  const deltaY = point.y - 0.5;
  return {
    h: ((Math.atan2(deltaY, deltaX) * 180) / Math.PI + 360) % 360,
    s: Math.min(1, Math.hypot(deltaX, deltaY) / 0.48),
  };
}

export function wheelPoint(hue: number, saturation: number, radius = 0.48): PickerPoint {
  const angle = (hue * Math.PI) / 180;
  return {
    x: 0.5 + Math.cos(angle) * saturation * radius,
    y: 0.5 + Math.sin(angle) * saturation * radius,
  };
}
