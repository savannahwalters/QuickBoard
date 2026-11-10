import type { LCInstance } from '../../literally-canvas-interfaces';
import { restoreShapes, snapshotShapes, type ShapeSnapshots } from './shape-transforms';
import { setSelection, setSelectionRegion, type SelectionRegion } from './selection-state';

type Shape = Record<string, unknown>;
export interface SelectionSnapshot {
  shapes: unknown[];
  states: ShapeSnapshots;
  selected: Shape[];
  region: SelectionRegion | null;
}

export function captureSelection(
  lc: LCInstance,
  selected: readonly Shape[],
  region: SelectionRegion | null
): SelectionSnapshot {
  return {
    shapes: [...lc.shapes],
    states: snapshotShapes(selected),
    selected: [...selected],
    region,
  };
}

export class SelectionAction {
  constructor(
    private readonly lc: LCInstance,
    private readonly before: SelectionSnapshot,
    private readonly after: SelectionSnapshot
  ) {}

  do(): void {
    this.apply(this.after);
  }
  undo(): void {
    this.apply(this.before);
  }

  private apply(snapshot: SelectionSnapshot): void {
    restoreShapes(snapshot.states);
    this.lc.shapes.splice(0, this.lc.shapes.length, ...snapshot.shapes);
    setSelection(this.lc, [...snapshot.selected]);
    setSelectionRegion(this.lc, snapshot.region);
    this.lc.repaintLayer('main');
  }
}
