import type { LCInstance, LCTool } from '../literally-canvas-interfaces';
import { constrainSquare, type DragPoint } from './drag-geometry';

/** Adds live aspect constraints while retaining LC's native drawing and history. */
export class ConstrainedShapeTool implements LCTool {
  usesSimpleAPI = true;
  private shift = false;
  private start: DragPoint | null = null;
  private endPoint: DragPoint | null = null;

  constructor(private readonly lc: LCInstance, private readonly tool: LCTool) {}

  get name() {
    return this.tool.name;
  }
  get iconName() {
    return this.tool.iconName;
  }
  get optionsStyle() {
    return this.tool.optionsStyle;
  }
  get strokeWidth() {
    return this.tool.strokeWidth;
  }
  set strokeWidth(value: number | undefined) {
    this.tool.strokeWidth = value;
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    this.shift = event.shiftKey;
  };

  private readonly key = (event: KeyboardEvent): void => {
    if (this.shift === event.shiftKey) return;
    this.shift = event.shiftKey;
    this.preview();
  };

  private readonly blur = (): void => {
    this.shift = false;
    this.preview();
  };

  didBecomeActive(): void {
    this.tool.didBecomeActive?.(this.lc);
    this.lc.canvas.addEventListener('pointerdown', this.pointerDown, true);
    window.addEventListener('keydown', this.key);
    window.addEventListener('keyup', this.key);
    window.addEventListener('blur', this.blur);
  }

  willBecomeInactive(): void {
    this.lc.canvas.removeEventListener('pointerdown', this.pointerDown, true);
    window.removeEventListener('keydown', this.key);
    window.removeEventListener('keyup', this.key);
    window.removeEventListener('blur', this.blur);
    this.start = this.endPoint = null;
    this.shift = false;
    this.tool.willBecomeInactive?.(this.lc);
  }

  begin(x: number, y: number): void {
    this.start = this.endPoint = { x, y };
    this.tool.begin?.(x, y, this.lc);
  }

  ['continue'](x: number, y: number): void {
    this.endPoint = { x, y };
    this.preview();
  }

  end(x: number, y: number): void {
    if (!this.start) return;
    this.continue(x, y);
    const end = this.shift ? constrainSquare(this.start, { x, y }) : { x, y };
    this.tool.end?.(end.x, end.y, this.lc);
    this.start = this.endPoint = null;
  }

  private preview(): void {
    if (!this.start || !this.endPoint) return;
    const end = this.shift ? constrainSquare(this.start, this.endPoint) : this.endPoint;
    this.tool.continue?.(end.x, end.y, this.lc);
  }
}
