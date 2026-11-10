import type { LCInstance, LCTool } from '../literally-canvas-interfaces';
import { constrainSquare } from './drag-geometry';
import {
  getSelectionBounds,
  getShapeBounds,
  type SelectionBounds,
} from './improved-select/geometry';
import { hitSelectionHandle, type GroupHandle } from './improved-select/selection-handles';
import { pointInSelection, type SelectionMode } from './improved-select/selection-geometry';
import { legacyMasks, renderShape, ShapeHitTesting } from './improved-select/shape-hit-testing';
import { bakeLegacyMasks, imageShape, regionPieces } from './improved-select/selection-raster';
import {
  captureSelection,
  SelectionAction,
  type SelectionSnapshot,
} from './improved-select/selection-action';
import {
  resizeShapes,
  rotateShapes,
  restoreShapes,
  snapshotShapes,
  translateShapes,
  prepareTransform,
  type ShapeSnapshots,
} from './improved-select/shape-transforms';
import {
  getSelection,
  getSelectionRegion,
  setSelection,
  setSelectionRegion,
  type SelectionRegion,
} from './improved-select/selection-state';

type Shape = Record<string, unknown>;
interface Point {
  x: number;
  y: number;
}
interface Gesture {
  mode: 'move' | GroupHandle;
  start: Point;
  point: Point;
  bounds: SelectionBounds;
  before: SelectionSnapshot;
  states: ShapeSnapshots;
  crop: boolean;
  stretchStates: ShapeSnapshots | null;
  changed: boolean;
  prepared: boolean;
  scene: unknown[] | null;
}

/**
 * All selectors share renderer-based picking, screen-sized handles, and snapshot undo.
 * Middle handles stretch; Shift-middle handles crop the selected group as one region.
 * Corner handles scale uniformly unless Shift is currently held.
 * New shape types participate through LC bounds/serialization/rendering; transforms
 * without a native geometry adapter use an undoable raster conversion.
 */
export class ImprovedSelectShape implements LCTool {
  name = 'SelectShape';
  iconName = 'select';
  usesSimpleAPI = false;
  private readonly hits = new ShapeHitTesting(() => this.lc.shapes);
  private unsubscribers: (() => void)[] = [];
  private selected: Shape[] = [];
  private shift = false;
  private start: Point = { x: 0, y: 0 };
  private selectionEnd: Point = { x: 0, y: 0 };
  private rawSelectionEnd: Point = { x: 0, y: 0 };
  private path: Point[] = [];
  private preview: Point | null = null;
  private marquee = false;
  private additive = false;
  private gesture: Gesture | null = null;
  private previews = new WeakMap<SelectionRegion, Shape[]>();

  constructor(
    private readonly lc: LCInstance,
    private readonly selectionMode: 'object' | SelectionMode = 'object',
    private readonly onRegionSelectionComplete?: () => void
  ) {}

  didBecomeActive(lc: LCInstance): void {
    this.selected = getSelection(lc);
    this.listen('lc-pointerdown', (point) => this.down(point as Point));
    this.listen('lc-pointerdrag', (point) => this.drag(point as Point));
    this.listen('lc-pointerup', (point) => this.up(point as Point));
    this.listen('zoom', () => this.overlay());
    this.listen('lc-pointermove', (point) => {
      if (this.selectionMode === 'polygon' && this.marquee) {
        this.preview = point as Point;
        this.overlay();
      }
    });
    this.listen('drawingChange', () => {
      this.hits.clear();
      this.previews = new WeakMap();
      this.selected = getSelection(lc).filter((shape) => lc.shapes.includes(shape));
      setSelection(lc, this.selected);
      this.overlay();
    });
    const pointerDown = (event: PointerEvent) => {
      this.shift = event.shiftKey;
    };
    const updateShift = (shift: boolean) => {
      if (this.shift === shift) return;
      this.shift = shift;
      if (this.marquee && this.hasAspectConstraint()) {
        this.updateSelectionEnd(this.rawSelectionEnd);
        this.overlay();
      } else if (this.gesture && this.isCorner(this.gesture.mode)) {
        this.drag(this.gesture.point);
      }
    };
    const key = (event: KeyboardEvent) => updateShift(event.shiftKey);
    const blur = () => updateShift(false);
    const hover = (event: PointerEvent) => {
      if (this.gesture || this.marquee) return;
      const rect = lc.canvas.getBoundingClientRect();
      const point = {
        x: (event.clientX - rect.left - lc.position.x / lc.backingScale) / lc.scale,
        y: (event.clientY - rect.top - lc.position.y / lc.backingScale) / lc.scale,
      };
      lc.canvas.style.cursor = this.cursor(this.handle(point));
    };
    lc.canvas.addEventListener('pointerdown', pointerDown, true);
    lc.canvas.addEventListener('pointermove', hover);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', blur);
    this.unsubscribers.push(() => {
      lc.canvas.removeEventListener('pointerdown', pointerDown, true);
      lc.canvas.removeEventListener('pointermove', hover);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', blur);
    });
    this.overlay();
  }

  willBecomeInactive(lc: LCInstance): void {
    this.commitGesture();
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.gesture = null;
    this.marquee = false;
    this.path = [];
    this.preview = null;
    this.shift = false;
    this.hits.clear();
    lc.setShapesInProgress([]);
    lc.repaintLayer('main');
    lc.canvas.style.cursor = 'default';
  }

  private listen(event: string, handler: (data: unknown) => void): void {
    const unsubscribe = this.lc.on(event, handler);
    if (unsubscribe) this.unsubscribers.push(unsubscribe);
  }

  getSelectedShapes(): readonly Shape[] {
    return this.selected;
  }

  getCopyShapes(): readonly Shape[] {
    const region = getSelectionRegion(this.lc);
    if (region) {
      return region.shapes.flatMap((shape) => regionPieces(shape, region, true, this.lc.shapes));
    }
    return this.selected.map((shape) => {
      if (!legacyMasks(shape, this.lc.shapes).length) return shape;
      const bounds = getShapeBounds(shape);
      if (!bounds) throw new Error('Cannot copy masked artwork without bounds.');
      return imageShape(renderShape(shape, bounds, this.lc.shapes), bounds);
    });
  }

  deleteSelectedShapes(beforeDelete?: () => void): boolean {
    this.commitGesture();
    const selected = this.selected.filter((shape) => this.lc.shapes.includes(shape));
    if (!selected.length) return false;
    beforeDelete?.();
    let region = getSelectionRegion(this.lc);
    const before = captureSelection(this.lc, selected, region);
    if (region) {
      this.bakeLegacyArtwork();
      region = getSelectionRegion(this.lc);
    }
    const removed = new Set(this.selected);
    const remaining = (this.lc.shapes as Shape[]).flatMap((shape) => {
      if (!removed.has(shape)) return [shape];
      return region ? regionPieces(shape, region, false, this.lc.shapes) : [];
    });
    this.lc.shapes.splice(0, this.lc.shapes.length, ...remaining);
    setSelectionRegion(this.lc, null);
    this.setSelected([]);
    this.lc.execute(new SelectionAction(this.lc, before, captureSelection(this.lc, [], null)));
    this.lc.trigger('drawingChange', {});
    return true;
  }

  selectShapes(shapes: Shape[]): void {
    setSelectionRegion(this.lc, null);
    this.setSelected(shapes);
  }

  clearSelection(): void {
    this.commitGesture();
    this.marquee = false;
    this.path = [];
    this.preview = null;
    setSelectionRegion(this.lc, null);
    this.setSelected([]);
  }

  private setSelected(shapes: Shape[]): void {
    this.selected = shapes;
    setSelection(this.lc, shapes);
    this.lc.trigger('shapeSelected', { selectedShape: shapes.at(-1) ?? null });
    this.overlay();
  }

  private unit(): number {
    return 1 / (this.lc.scale || 1);
  }

  private transformShapes(): Shape[] {
    const region = getSelectionRegion(this.lc);
    if (!region)
      return this.selected.map((shape) => {
        // Fill images can contain canvas-sized transparent margins.
        if (shape['className'] !== 'Image') return shape;
        const bounds = this.hits.visibleBounds(shape) ?? getShapeBounds(shape);
        return bounds ? { getBoundingRect: () => bounds } : shape;
      });
    let shapes = this.previews.get(region);
    if (!shapes) {
      shapes = region.shapes.flatMap((shape) => regionPieces(shape, region, true, this.lc.shapes));
      this.previews.set(region, shapes);
    }
    return shapes;
  }

  private handle(point: Point): GroupHandle | null {
    return this.selected.length
      ? hitSelectionHandle(getSelectionBounds(this.transformShapes()), point, this.unit())
      : null;
  }

  private cursor(mode: GroupHandle | null): string {
    if (!mode) return 'default';
    if (mode === 'group-rotate') return 'pointer';
    if (mode === 'group-l' || mode === 'group-r') return 'ew-resize';
    if (mode === 'group-t' || mode === 'group-b') return 'ns-resize';
    return mode === 'group-tl' || mode === 'group-br' ? 'nwse-resize' : 'nesw-resize';
  }

  private down(point: Point): void {
    if (this.selectionMode !== 'object') {
      if (this.selectionMode !== 'polygon' || !this.marquee) {
        this.start = { ...point };
        this.updateSelectionEnd(point);
        this.path = [];
        setSelectionRegion(this.lc, null);
        this.setSelected([]);
      }
      this.marquee = true;
      this.preview = { ...point };
      if (this.selectionMode === 'lasso') this.path = [{ ...point }];
      this.overlay();
      return;
    }
    const handle = this.handle(point);
    if (handle) {
      this.beginGesture(point, handle);
      return;
    }
    // Image interiors must not consume Shift-clicks that toggle selection membership.
    if (this.shift) {
      const hit = this.hits.hit(this.lc.shapes as Shape[], point, 3 * this.unit());
      if (hit) {
        setSelectionRegion(this.lc, null);
        this.setSelected(
          this.selected.includes(hit)
            ? this.selected.filter((s) => s !== hit)
            : [...this.selected, hit]
        );
        return;
      }
    }
    const region = getSelectionRegion(this.lc);
    const hit = this.hits.hit(this.lc.shapes as Shape[], point, 3 * this.unit());
    if (region && pointInSelection(point, region.start, region.end, region.mode, region.path)) {
      this.beginGesture(point, 'move');
      return;
    }
    if (hit) {
      if (region || !this.selected.includes(hit)) {
        setSelectionRegion(this.lc, null);
        this.setSelected([hit]);
      }
      this.beginGesture(point, 'move');
      return;
    }
    setSelectionRegion(this.lc, null);
    this.additive = this.shift;
    if (!this.additive) this.setSelected([]);
    this.start = { ...point };
    this.selectionEnd = { ...point };
    this.path = [];
    this.marquee = true;
    this.overlay();
  }

  private beginGesture(point: Point, mode: Gesture['mode']): void {
    this.gesture = {
      mode,
      start: { ...point },
      point: { ...point },
      bounds: getSelectionBounds(this.transformShapes()),
      before: captureSelection(this.lc, this.selected, getSelectionRegion(this.lc)),
      states: new Map(),
      crop: this.shift && ['group-t', 'group-b', 'group-l', 'group-r'].includes(mode),
      stretchStates: null,
      changed: false,
      prepared: false,
      scene: null,
    };
    this.lc.canvas.style.cursor = mode === 'move' ? 'grabbing' : this.cursor(mode);
  }

  private prepare(gesture: Gesture): void {
    if (gesture.prepared) return;
    this.bakeLegacyArtwork();
    gesture.prepared = true;
    const region = getSelectionRegion(this.lc);
    if (region) {
      const fragments: Shape[] = [];
      const sources = new Set(region.shapes);
      const next = (this.lc.shapes as Shape[]).flatMap((shape) => {
        if (!sources.has(shape)) return [shape];
        const selected = regionPieces(shape, region, true, this.lc.shapes);
        if (!selected.length) return [shape];
        fragments.push(...selected);
        return [...regionPieces(shape, region, false, this.lc.shapes), ...selected];
      });
      this.lc.shapes.splice(0, this.lc.shapes.length, ...next);
      setSelectionRegion(this.lc, null);
      this.selected = fragments;
    }
    if (!gesture.crop) {
      for (const shape of this.selected)
        prepareTransform(
          shape,
          gesture.mode === 'move'
            ? 'move'
            : ['group-t', 'group-b', 'group-l', 'group-r'].includes(gesture.mode)
            ? 'stretch'
            : 'transform'
        );
    }
    gesture.states = snapshotShapes(this.selected);
    setSelection(this.lc, this.selected);
  }

  private bakeLegacyArtwork(): void {
    const { shapes, replacements } = bakeLegacyMasks(this.lc.shapes);
    this.lc.shapes.splice(0, this.lc.shapes.length, ...shapes);
    this.selected = this.selected.map((shape) => replacements.get(shape) ?? shape);
    const region = getSelectionRegion(this.lc);
    if (region) {
      setSelectionRegion(this.lc, {
        ...region,
        shapes: region.shapes.map((shape) => replacements.get(shape) ?? shape),
      });
    }
    setSelection(this.lc, this.selected);
    this.hits.clear();
  }

  private drag(point: Point): void {
    if (this.marquee) {
      this.updateSelectionEnd(point);
      this.preview = { ...point };
      if (this.selectionMode === 'lasso') this.path.push({ ...point });
      this.overlay();
      return;
    }
    const gesture = this.gesture;
    if (gesture) gesture.point = { ...point };
    if (
      !gesture ||
      (point.x === gesture.start.x && point.y === gesture.start.y && !gesture.changed)
    )
      return;
    this.prepare(gesture);
    gesture.changed = true;
    const { x, y, width, height } = gesture.bounds;
    const dx = point.x - gesture.start.x,
      dy = point.y - gesture.start.y;
    if (gesture.crop) {
      this.crop(gesture, point);
    } else if (gesture.mode === 'move') {
      translateShapes(gesture.states, dx, dy);
    } else if (gesture.mode === 'group-rotate') {
      const center = { x: x + width / 2, y: y + height / 2 };
      rotateShapes(
        gesture.states,
        center,
        Math.atan2(point.y - center.y, point.x - center.x) -
          Math.atan2(gesture.start.y - center.y, gesture.start.x - center.x)
      );
    } else if (width > 0 && height > 0) {
      const suffix = gesture.mode.replace('group-', '');
      const left = suffix.includes('l'),
        top = suffix.includes('t');
      const horizontal = suffix === 'l' || suffix === 'r';
      const vertical = suffix === 't' || suffix === 'b';
      const anchor = { x: left ? x + width : x, y: top ? y + height : y };
      let sx = vertical ? 1 : Math.max(0.01, ((point.x - anchor.x) * (left ? -1 : 1)) / width);
      let sy = horizontal ? 1 : Math.max(0.01, ((point.y - anchor.y) * (top ? -1 : 1)) / height);
      let states = gesture.states;
      if (!horizontal && !vertical) {
        if (this.shift) {
          if (!gesture.stretchStates) {
            restoreShapes(gesture.states);
            for (const shape of this.selected) prepareTransform(shape, 'stretch');
            gesture.stretchStates = snapshotShapes(this.selected);
          }
          states = gesture.stretchStates;
        } else {
          sx = sy = Math.max(sx, sy);
        }
      }
      resizeShapes(states, anchor, sx, sy);
    }
    this.hits.clear();
    this.overlay();
  }

  private isCorner(mode: Gesture['mode']): boolean {
    return ['group-tl', 'group-tr', 'group-bl', 'group-br'].includes(mode);
  }

  private crop(gesture: Gesture, point: Point): void {
    const { x, y, width, height } = gesture.bounds;
    let left = x,
      top = y,
      right = x + width,
      bottom = y + height;
    if (gesture.mode === 'group-l') left = Math.min(right - this.unit(), Math.max(x, point.x));
    if (gesture.mode === 'group-r') right = Math.max(left + this.unit(), Math.min(right, point.x));
    if (gesture.mode === 'group-t') top = Math.min(bottom - this.unit(), Math.max(y, point.y));
    if (gesture.mode === 'group-b') bottom = Math.max(top + this.unit(), Math.min(bottom, point.y));
    restoreShapes(gesture.states);
    const sources = new Set(gesture.states.keys());
    const region: SelectionRegion = {
      start: { x: left, y: top },
      end: { x: right, y: bottom },
      mode: 'rectangle',
      path: [],
      shapes: [...sources],
    };
    // Rebuild from the pre-crop scene, retaining original interleaving and unselected objects.
    const scene = gesture.scene ?? [...this.lc.shapes];
    gesture.scene = scene;
    const selected: Shape[] = [];
    const next = scene.flatMap((item) => {
      const shape = item as Shape;
      if (!sources.has(shape)) return [shape];
      const fragments = regionPieces(shape, region, true, scene);
      selected.push(...fragments);
      return fragments;
    });
    this.lc.shapes.splice(0, this.lc.shapes.length, ...next);
    this.selected = selected;
    setSelection(this.lc, this.selected);
  }

  private up(point: Point): void {
    if (this.marquee) {
      if (this.selectionMode === 'polygon') {
        const first = this.path[0];
        if (
          !first ||
          this.path.length < 3 ||
          Math.hypot(point.x - first.x, point.y - first.y) > 10 * this.unit()
        ) {
          this.path.push({ ...point });
          this.preview = { ...point };
          this.overlay();
          return;
        }
      } else {
        this.updateSelectionEnd(point);
        if (this.selectionMode === 'lasso') this.path.push({ ...point });
      }
      if (
        (this.selectionMode === 'polygon' || this.selectionMode === 'lasso') &&
        this.path.length
      ) {
        this.start = {
          x: Math.min(...this.path.map((p) => p.x)),
          y: Math.min(...this.path.map((p) => p.y)),
        };
        this.selectionEnd = {
          x: Math.max(...this.path.map((p) => p.x)),
          y: Math.max(...this.path.map((p) => p.y)),
        };
      }
      const mode = this.selectionMode === 'object' ? 'rectangle' : this.selectionMode;
      const valid = this.start.x !== this.selectionEnd.x && this.start.y !== this.selectionEnd.y;
      const found = valid
        ? (this.lc.shapes as Shape[]).filter((shape) =>
            this.hits.intersects(shape, this.start, this.selectionEnd, mode, this.path)
          )
        : [];
      this.marquee = false;
      if (this.selectionMode === 'object') {
        this.setSelected(this.additive ? [...new Set([...this.selected, ...found])] : found);
      } else {
        this.selected = found;
        setSelectionRegion(
          this.lc,
          found.length
            ? {
                start: this.start,
                end: this.selectionEnd,
                mode,
                path: [...this.path],
                shapes: found,
              }
            : null
        );
        this.setSelected(found);
        this.onRegionSelectionComplete?.();
      }
      return;
    }
    const gesture = this.gesture;
    if (!gesture) return;
    this.drag(point);
    this.commitGesture();
    this.lc.canvas.style.cursor = 'default';
    this.overlay();
  }

  private commitGesture(): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture?.changed) {
      this.lc.execute(
        new SelectionAction(
          this.lc,
          gesture.before,
          captureSelection(this.lc, this.selected, getSelectionRegion(this.lc))
        )
      );
      this.lc.trigger('drawingChange', {});
    }
  }

  private hasAspectConstraint(): boolean {
    return this.selectionMode === 'rectangle' || this.selectionMode === 'circle';
  }

  private updateSelectionEnd(point: Point): void {
    this.rawSelectionEnd = { ...point };
    this.selectionEnd =
      this.shift && this.hasAspectConstraint()
        ? constrainSquare(this.start, point)
        : { ...point };
  }

  private overlay(): void {
    const unit = this.unit();
    this.lc.setShapesInProgress(
      this.marquee
        ? [
            LC.createShape('SelectionRegionOverlay', {
              start: this.start,
              end: this.selectionEnd,
              mode: this.selectionMode === 'object' ? 'rectangle' : this.selectionMode,
              path:
                this.selectionMode === 'polygon' && this.preview
                  ? [...this.path, this.preview]
                  : this.path,
              unit,
            }),
          ]
        : this.selected.length
        ? [LC.createShape('SelectionGroupOverlay', { shapes: this.transformShapes(), unit })]
        : []
    );
    this.lc.repaintLayer('main');
  }
}
