import { describe, expect, it, vi } from 'vitest';
import { eraseRaster, eraserBounds } from './erase-raster';

describe('pixel eraser raster', () => {
  const bounds = { x: 100, y: 200, width: 40, height: 20 };

  function setup(changed = true) {
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      getImageData: vi
        .fn()
        .mockReturnValueOnce({ data: new Uint8ClampedArray([10, 20, 30, 255]) })
        .mockReturnValue({ data: new Uint8ClampedArray([10, 20, 30, changed ? 0 : 255]) }),
    };
    const canvas = {
      width: 80,
      height: 60,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    return { canvas, context };
  }

  it('covers the entire segment including both rounded ends', () => {
    expect(eraserBounds({ x: 20, y: 30 }, { x: -10, y: 80 }, 10)).toEqual({
      x: -15,
      y: 25,
      width: 40,
      height: 60,
    });
  });

  it('cuts a click-sized circle in drawing coordinates regardless of raster scale', () => {
    const { canvas, context } = setup();
    expect(eraseRaster(canvas, bounds, { x: 110, y: 210 }, { x: 110, y: 210 }, 6)).toBe(true);
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 3, -200, -600);
    expect(context.arc).toHaveBeenCalledWith(110, 210, 3, 0, Math.PI * 2);
    expect(context.fill).toHaveBeenCalledOnce();
    expect(context).toMatchObject({ globalCompositeOperation: 'destination-out' });
  });

  it('connects sparse drag events and the final pointer position without gaps', () => {
    const { canvas, context } = setup();
    eraseRaster(canvas, bounds, { x: 105, y: 210 }, { x: 135, y: 210 }, 8);
    expect(context.moveTo).toHaveBeenCalledWith(105, 210);
    expect(context.lineTo).toHaveBeenCalledWith(135, 210);
    expect(context).toMatchObject({ lineWidth: 8, lineCap: 'round', lineJoin: 'round' });
    expect(context.stroke).toHaveBeenCalledOnce();
  });

  it('does not count transparent pixels as an edit', () => {
    const { canvas } = setup(false);
    expect(eraseRaster(canvas, bounds, { x: 110, y: 210 }, { x: 115, y: 210 }, 6)).toBe(false);
  });

  it('avoids pixel reads outside the raster', () => {
    const { canvas, context } = setup();
    expect(eraseRaster(canvas, bounds, { x: 0, y: 0 }, { x: 5, y: 0 }, 6)).toBe(false);
    expect(context.getImageData).not.toHaveBeenCalled();
  });
});
