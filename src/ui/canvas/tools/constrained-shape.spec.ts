import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LCInstance } from '../literally-canvas-interfaces';
import { ConstrainedShapeTool } from './constrained-shape';
import { constrainSquare } from './drag-geometry';

describe('constrained shape drawing', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function setup() {
    const lc = { canvas: document.createElement('canvas') } as LCInstance;
    const native = {
      name: 'Rectangle',
      iconName: 'rectangle',
      optionsStyle: 'stroke-width',
      strokeWidth: 5,
      begin: vi.fn(),
      continue: vi.fn(),
      end: vi.fn(),
      didBecomeActive: vi.fn(),
      willBecomeInactive: vi.fn(),
    };
    const tool = new ConstrainedShapeTool(lc, native);
    tool.didBecomeActive();
    cleanups.push(() => tool.willBecomeInactive());
    const shift = (held: boolean) =>
      window.dispatchEvent(
        new KeyboardEvent(held ? 'keydown' : 'keyup', { key: 'Shift', shiftKey: held })
      );
    return { tool, native, lc, shift };
  }

  it.each([
    [50, 20, 50, 50],
    [-50, 20, -50, 50],
    [50, -20, 50, -50],
    [-50, -20, -50, -50],
    [0, 20, 20, 20],
    [20, 0, 20, 20],
    [0, 0, 0, 0],
  ])('constrains signed drag (%s, %s) to (%s, %s)', (dx, dy, x, y) => {
    expect(constrainSquare({ x: 10, y: 10 }, { x: 10 + dx, y: 10 + dy })).toEqual({
      x: 10 + x,
      y: 10 + y,
    });
  });

  it('updates immediately on Shift press/release without losing the raw pointer position', () => {
    const { tool, native, lc, shift } = setup();
    tool.begin(10, 20);
    tool.continue(80, 50);
    expect(native.continue).toHaveBeenLastCalledWith(80, 50, lc);
    shift(true);
    expect(native.continue).toHaveBeenLastCalledWith(80, 90, lc);
    tool.continue(-30, 80);
    expect(native.continue).toHaveBeenLastCalledWith(-50, 80, lc);
    shift(false);
    expect(native.continue).toHaveBeenLastCalledWith(-30, 80, lc);
    shift(true);
    tool.end(100, 40);
    expect(native.continue).toHaveBeenLastCalledWith(100, 110, lc);
    expect(native.end).toHaveBeenCalledExactlyOnceWith(100, 110, lc);
    shift(false);
    expect(native.continue).toHaveBeenCalledTimes(6);
  });

  it('honors Shift already held on pointer down and saves unconstrained after release', () => {
    const { tool, native, lc, shift } = setup();
    lc.canvas.dispatchEvent(new MouseEvent('pointerdown', { shiftKey: true }));
    tool.begin(0, 0);
    tool.continue(20, 40);
    expect(native.continue).toHaveBeenLastCalledWith(40, 40, lc);
    shift(false);
    tool.end(30, 50);
    expect(native.end).toHaveBeenLastCalledWith(30, 50, lc);
  });

  it('preserves native options/lifecycle and clears listeners and pending previews on deactivation', () => {
    const { tool, native, lc, shift } = setup();
    tool.strokeWidth = 12;
    expect(native.strokeWidth).toBe(12);
    expect(tool.name).toBe('Rectangle');
    expect(tool.iconName).toBe('rectangle');
    expect(tool.optionsStyle).toBe('stroke-width');
    expect(native.didBecomeActive).toHaveBeenCalledExactlyOnceWith(lc);
    tool.begin(0, 0);
    tool.continue(20, 40);
    shift(true);
    window.dispatchEvent(new Event('blur'));
    expect(native.continue).toHaveBeenLastCalledWith(20, 40, lc);
    tool.willBecomeInactive();
    native.continue.mockClear();
    shift(true);
    expect(native.continue).not.toHaveBeenCalled();
    expect(native.willBecomeInactive).toHaveBeenCalledWith(lc);
  });
});
