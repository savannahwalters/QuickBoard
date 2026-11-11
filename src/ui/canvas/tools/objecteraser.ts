import type { LCInstance, LCTool } from '../literally-canvas-interfaces';
import {
  captureSelection,
  SelectionAction,
  type SelectionSnapshot,
} from './improved-select/selection-action';
import { getSelection, getSelectionRegion } from './improved-select/selection-state';
import { ShapeHitTesting } from './improved-select/shape-hit-testing';

export class ObjectEraser implements LCTool {
  name = 'Object Eraser';
  iconName = 'object-eraser';
  strokeWidth = 20;
  optionsStyle = 'stroke-width';
  usesSimpleAPI = true;

  private readonly hits = new ShapeHitTesting(() => this.lc.shapes);
  private before: SelectionSnapshot | null = null;
  private changed = false;

  constructor(private readonly lc: LCInstance, private readonly beforeErase?: () => void) {}

  didBecomeActive(): void {
    this.hits.clear();
  }

  begin(x: number, y: number): void {
    this.finish();
    this.beforeErase?.();
    this.hits.clear();
    this.before = captureSelection(this.lc, getSelection(this.lc), getSelectionRegion(this.lc));
    this.eraseAtPoint(x, y);
  }

  ['continue'](x: number, y: number): void {
    if (this.before) this.eraseAtPoint(x, y);
  }

  end(x: number, y: number): void {
    this.continue(x, y);
    this.finish();
  }

  willBecomeInactive(): void {
    this.finish();
    this.hits.clear();
  }

  private eraseAtPoint(x: number, y: number): void {
    const remaining = this.lc.shapes.filter((item) => {
      const shape = item as Record<string, unknown>;
      // Old projects can contain masks; erasing a mask would reveal deleted artwork.
      return (
        shape['className'] === 'ErasedLinePath' ||
        !this.hits.hit([shape], { x, y }, this.strokeWidth / 2)
      );
    });
    if (remaining.length === this.lc.shapes.length) return;
    this.changed = true;
    this.lc.shapes.splice(0, this.lc.shapes.length, ...remaining);
    this.lc.repaintLayer('main');
  }

  private finish(): void {
    if (this.before && this.changed) {
      this.lc.execute(
        new SelectionAction(this.lc, this.before, captureSelection(this.lc, [], null))
      );
      this.lc.trigger('drawingChange', {});
    }
    this.before = null;
    this.changed = false;
  }
}
