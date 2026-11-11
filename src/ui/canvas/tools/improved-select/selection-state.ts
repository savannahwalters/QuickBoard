import type { LCInstance } from '../../literally-canvas-interfaces';

export interface SelectionRegion {
  start: { x: number; y: number };
  end: { x: number; y: number };
  mode: 'rectangle' | 'circle' | 'polygon' | 'lasso';
  path: { x: number; y: number }[];
  shapes: Record<string, unknown>[];
}

const selections = new WeakMap<LCInstance, Record<string, unknown>[]>();
const selectionRegions = new WeakMap<LCInstance, SelectionRegion>();

export function getSelection(lc: LCInstance): Record<string, unknown>[] {
  const shapes = (selections.get(lc) ?? []).filter((shape) => lc.shapes.includes(shape));
  selections.set(lc, shapes);
  return shapes;
}

export function setSelection(lc: LCInstance, shapes: Record<string, unknown>[]): void {
  selections.set(lc, shapes);
}

export function getSelectionRegion(lc: LCInstance): SelectionRegion | null {
  const region = selectionRegions.get(lc);
  if (!region) return null;
  const shapes = region.shapes.filter((shape) => lc.shapes.includes(shape));
  if (!shapes.length) {
    selectionRegions.delete(lc);
    return null;
  }
  const current = shapes.length === region.shapes.length ? region : { ...region, shapes };
  selectionRegions.set(lc, current);
  return current;
}

export function setSelectionRegion(lc: LCInstance, region: SelectionRegion | null): void {
  if (region) {
    selectionRegions.set(lc, region);
  } else {
    selectionRegions.delete(lc);
  }
}
