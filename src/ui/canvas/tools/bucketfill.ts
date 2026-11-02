import { LCInstance } from '../literally-canvas-interfaces';

// Fill Tool - fills an area with a color
export class BucketFill {
  name = 'Bucket Fill';
  iconName = 'bucket-fill';
  optionsStyle = '';
  usesSimpleAPI = true;
  tolerance = 16;

  // Render source image at half resolution for faster flood fill (4× fewer pixels).
  // The saved Image shape uses scale: 2 to stretch it back to full world size.
  private static readonly SRC_SCALE = 0.5;

  constructor(private lc: LCInstance) { /* no-op */ }

  begin(x: number, y: number, lc: LCInstance): void {
    const color = lc.getColor('secondary') || '#000000';
    const fillColor = parseFillColor(color);
    if (!fillColor) return;

    const srcScale = BucketFill.SRC_SCALE;

    // Get a composite snapshot (background color + all shapes) at reduced resolution.
    const sourceCanvas = lc.getImage({ scale: srcScale });
    if (!sourceCanvas) return;

    const { width, height } = sourceCanvas;
    const sourceCtx = sourceCanvas.getContext('2d');
    if (!sourceCtx) return;

    // x, y are world coordinates — scale them to match the source canvas.
    const px = Math.round(x * srcScale);
    const py = Math.round(y * srcScale);
    if (px < 0 || py < 0 || px >= width || py >= height) return;

    const imageData = sourceCtx.getImageData(0, 0, width, height);
    const targetColor = this.getPixel(imageData, px, py);
    if (!targetColor || this.colorsMatch(targetColor, fillColor, 0)) return;

    // Flood fill into a separate transparent canvas (only filled pixels are set).
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext('2d')!;
    const fillData = new ImageData(width, height); // all transparent initially
    this.floodFill(imageData, fillData, px, py, targetColor, fillColor);
    offCtx.putImageData(fillData, 0, 0);

    const shape = LC.createShape('Image', {
      x: 0,
      y: 0,
      image: Object.defineProperty(offscreen, 'src', { value: offscreen.toDataURL('image/png') }),
      scale: 1 / srcScale, // stretches the half-res image back to full world size
    });
    lc.saveShape(shape);
  }

  // Flood fill from source ImageData into output ImageData (separate read/write
  // buffers prevent the fill from consuming its own written pixels).
  private floodFill(
    source: ImageData,
    output: ImageData,
    x: number,
    y: number,
    target: number[],
    fill: number[],
  ): void {
    const { width, height } = source;
    const visited = new Uint8Array(width * height);
    const stack: [number, number][] = [[x, y]];

    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      const flat = cy * width + cx;
      if (visited[flat]) continue;
      visited[flat] = 1;

      const idx = flat * 4;
      if (!this.colorsMatch(source.data.slice(idx, idx + 4), target, this.tolerance)) continue;

      for (let i = 0; i < 4; i++) output.data[idx + i] = fill[i];

      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  private getPixel(imageData: ImageData, x: number, y: number): number[] | null {
    const { width, height, data } = imageData;
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const idx = (y * width + x) * 4;
    return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
  }

  private colorsMatch(a: number[] | Uint8ClampedArray, b: number[], tolerance = 16): boolean {
    for (let i = 0; i < 4; i++) {
      if (Math.abs(a[i] - b[i]) > tolerance) return false;
    }
    return true;
  }

  end(): void { /* no-op */ }
  ['continue'](): void { /* no-op */ }

  willBecomeActive(): void { /* no-op */ }
  didBecomeActive(): void { /* no-op */ }
  willBecomeInactive(): void { /* no-op */ }
  didBecomeInactive(): void { /* no-op */ }
}

function parseFillColor(value: string): number[] | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'transparent') {
    return [0, 0, 0, 0];
  }

  const hexMatch = /^#([0-9a-f]{3,8})$/i.exec(normalized);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r, g, b, 255];
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
      return [r, g, b, a];
    }
  }

  const rgbMatch = /^rgba?\((.+)\)$/i.exec(normalized);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((part) => part.trim());
    if (parts.length < 3) return null;
    const r = parseRgbChannel(parts[0]);
    const g = parseRgbChannel(parts[1]);
    const b = parseRgbChannel(parts[2]);
    const a = parts.length > 3 ? parseAlphaChannel(parts[3]) : 255;
    return [r, g, b, a];
  }

  const hslMatch = /^hsla?\((.+)\)$/i.exec(normalized);
  if (hslMatch) {
    const parts = hslMatch[1].split(',').map((part) => part.trim());
    if (parts.length < 3) return null;
    const h = parseHue(parts[0]);
    const s = parsePercent(parts[1]);
    const l = parsePercent(parts[2]);
    const a = parts.length > 3 ? parseAlphaChannel(parts[3]) : 255;
    const rgb = hslToRgb(h, s, l);
    return [rgb.r, rgb.g, rgb.b, a];
  }

  return null;
}

function parseRgbChannel(value: string): number {
  if (value.endsWith('%')) {
    const percent = parseFloat(value);
    return clamp(Math.round((percent / 100) * 255), 0, 255);
  }
  return clamp(Math.round(parseFloat(value)), 0, 255);
}

function parseAlphaChannel(value: string): number {
  if (value.endsWith('%')) {
    const percent = parseFloat(value);
    return clamp(Math.round((percent / 100) * 255), 0, 255);
  }
  const num = parseFloat(value);
  if (Number.isNaN(num)) return 255;
  const normalized = num <= 1 ? num : 1;
  return clamp(Math.round(normalized * 255), 0, 255);
}

function parseHue(value: string): number {
  return ((parseFloat(value) % 360) + 360) % 360;
}

function parsePercent(value: string): number {
  const num = parseFloat(value);
  return clamp(num, 0, 100) / 100;
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
