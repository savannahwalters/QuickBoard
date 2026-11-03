import { hsvToRgbChannels, triangleColor, wheelColor } from './color-picker-geometry';

type SurfaceMode = 'triangle' | 'wheel';

class ColorPickerRaster {
  private readonly offsets: Uint32Array;
  private readonly channels: Float64Array;

  constructor(private readonly mode: SurfaceMode, size: number) {
    const offsets: number[] = [];
    this.channels = new Float64Array(size * size * 3);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const point = { x: (column + 0.5) / size, y: (row + 0.5) / size };
        const pixel = row * size + column;
        const offset = pixel * 3;
        if (mode === 'wheel') {
          if (Math.hypot(point.x - 0.5, point.y - 0.5) > 0.48) continue;
          const color = wheelColor(point);
          const rgb = hsvToRgbChannels(color.h, color.s, 1);
          this.channels[offset] = rgb.r;
          this.channels[offset + 1] = rgb.g;
          this.channels[offset + 2] = rgb.b;
        } else {
          const color = triangleColor(point, false);
          if (!color) continue;
          this.channels[offset] = color.s * color.v;
          this.channels[offset + 1] = (1 - color.s) * color.v * 255;
        }
        offsets.push(pixel);
      }
    }
    this.offsets = Uint32Array.from(offsets);
  }

  paint(data: Uint8ClampedArray, hue: number, value: number): void {
    data.fill(0);
    const rgb = hsvToRgbChannels(hue, 1, 1);
    for (const pixel of this.offsets) {
      const source = pixel * 3;
      const target = pixel * 4;
      if (this.mode === 'wheel') {
        data[target] = Math.round(this.channels[source] * value);
        data[target + 1] = Math.round(this.channels[source + 1] * value);
        data[target + 2] = Math.round(this.channels[source + 2] * value);
      } else {
        const hueWeight = this.channels[source];
        const white = this.channels[source + 1];
        data[target] = Math.round(rgb.r * hueWeight + white);
        data[target + 1] = Math.round(rgb.g * hueWeight + white);
        data[target + 2] = Math.round(rgb.b * hueWeight + white);
      }
      data[target + 3] = 255;
    }
  }
}

const surfaces = new Map<string, ColorPickerRaster>();

export function getColorPickerRaster(mode: SurfaceMode, size: number): ColorPickerRaster {
  const key = `${mode}:${size}`;
  let surface = surfaces.get(key);
  if (!surface) {
    surface = new ColorPickerRaster(mode, size);
    surfaces.set(key, surface);
  }
  return surface;
}
