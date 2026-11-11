import { describe, expect, it } from 'vitest';
import { hitSelectionHandle, selectionHandles } from './selection-handles';

describe('selection handles', () => {
  const bounds = { x: 100, y: 100, width: 200, height: 100 };

  it('shares all nine rendered locations with hit testing', () => {
    const handles = selectionHandles(bounds);
    expect(handles).toHaveLength(9);
    for (const handle of handles) {
      expect(hitSelectionHandle(bounds, handle)).toBe(handle.mode);
    }
    expect(hitSelectionHandle(bounds, { x: 200, y: 150 })).toBeNull();
  });

  it.each([0.25, 1, 4])(
    'keeps the rotate offset and grab tolerance consistent at zoom %s',
    (zoom) => {
      const unit = 1 / zoom;
      const rotate = selectionHandles(bounds, unit)[0];
      expect((bounds.y - rotate.y) * zoom).toBeCloseTo(25);
      expect(hitSelectionHandle(bounds, { x: rotate.x + 2 * unit, y: rotate.y }, unit)).toBe(
        'group-rotate'
      );
    }
  );

  it.each([0.25, 1, 4])('keeps thin-stroke handles clickable at zoom %s', (zoom) => {
    const unit = 1 / zoom;
    const thin = { x: 100, y: 100, width: 200, height: 1 };
    expect(hitSelectionHandle(thin, { x: 200, y: 100 - 4 * unit }, unit)).toBe('group-t');
    expect(hitSelectionHandle(thin, { x: 200, y: 101 + 4 * unit }, unit)).toBe('group-b');
    expect(hitSelectionHandle(thin, { x: 100 - 3 * unit, y: 100.5 }, unit)).toBe('group-l');
  });
});
