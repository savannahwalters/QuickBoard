import { describe, expect, it } from 'vitest';
import {
  TRIANGLE,
  triangleColor,
  trianglePoint,
  wheelColor,
  wheelPoint,
} from './color-picker-geometry';

describe('color picker geometry', () => {
  it('maps triangle vertices to pure hue, white, and black', () => {
    expect(triangleColor(TRIANGLE.hue)).toEqual({ s: 1, v: 1 });
    expect(triangleColor(TRIANGLE.white)).toEqual({ s: 0, v: 1 });
    expect(triangleColor(TRIANGLE.black)).toEqual({ s: 0, v: 0 });
  });

  it('round trips saturation and value throughout the triangle', () => {
    for (const saturation of [0, 0.25, 0.6, 1]) {
      for (const value of [0.1, 0.5, 1]) {
        const color = triangleColor(trianglePoint(saturation, value))!;
        expect(color.s).toBeCloseTo(saturation);
        expect(color.v).toBeCloseTo(value);
      }
    }
  });

  it('rejects empty space for rendering and projects drags onto the nearest edge', () => {
    expect(triangleColor({ x: 0, y: 0 }, false)).toBeNull();
    for (const point of [
      { x: -1, y: 0 },
      { x: 2, y: 2 },
      { x: 0.5, y: -1 },
    ]) {
      const color = triangleColor(point)!;
      expect(color.s).toBeGreaterThanOrEqual(0);
      expect(color.s).toBeLessThanOrEqual(1);
      expect(color.v).toBeGreaterThanOrEqual(0);
      expect(color.v).toBeLessThanOrEqual(1);
    }
  });

  it('round trips hue and saturation on the disc and clamps its perimeter', () => {
    for (const hue of [0, 60, 120, 180, 240, 300, 359]) {
      const color = wheelColor(wheelPoint(hue, 0.65));
      expect(color.h).toBeCloseTo(hue);
      expect(color.s).toBeCloseTo(0.65);
    }
    expect(wheelColor({ x: 2, y: 0.5 }).s).toBe(1);
    expect(wheelColor({ x: 0.5, y: 0.5 }).s).toBe(0);
  });
});
