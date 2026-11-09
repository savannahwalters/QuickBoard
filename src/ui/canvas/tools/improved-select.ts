import { LCInstance, LCTool } from '../literally-canvas-interfaces';
import { getResizeCursorForAngle, getRotateCursor } from './improved-select/cursors';
import {
  getGlobalPoint,
  getShapeBounds,
  getSelectionBounds,
  ptToLocal,
  setGlobalPointAnchor,
  type SelectionBounds,
} from './improved-select/geometry';
import { registerImprovedSelectShapes } from './improved-select/register-shapes';
import { TransformAction } from './improved-select/transform-action';
import {
  ResizeAction,
  resizeShapes,
  rotateShapes,
  snapshotShapes,
  type ShapeSnapshots,
} from './improved-select/resize-action';
import { ImageHandleMode } from './improved-select/types';
import { pointInSelection, type SelectionMode } from './improved-select/selection-geometry';
import {
  getSelection,
  getSelectionRegion,
  setSelection,
  setSelectionRegion,
  type SelectionRegion,
} from './improved-select/selection-state';

export { registerImprovedSelectShapes };

export class ImprovedSelectShape implements LCTool {
  name = 'SelectShape';
  iconName = 'select';
  usesSimpleAPI = false;

  private readonly selectCanvas = document.createElement('canvas');
  private readonly selectCtx = this.selectCanvas.getContext('2d', { willReadFrequently: true });
  private _selectShapeUnsubscribe: (() => void) | null = null;
  private selectedShape: Record<string, unknown> | null = null;
  private selectedShapes: Record<string, unknown>[] = [];
  private dragOffset = { x: 0, y: 0 };
  private selectionStart = { x: 0, y: 0 };
  private selectionEnd = { x: 0, y: 0 };
  private selectionPath: { x: number; y: number }[] = [];
  private polygonPoint: { x: number; y: number } | null = null;
  private resizeSnapshots: ShapeSnapshots = new Map();
  private resizeBounds: SelectionBounds = { x: 0, y: 0, width: 0, height: 0 };
  private shiftKeyDown = false;
  private additiveSelection = false;
  private groupStartPositions = new Map<Record<string, unknown>, { x: number; y: number }>();
  private partialSelectionRegion: SelectionRegion | null = null;
  private readonly partialPreviews = new WeakMap<SelectionRegion, Record<string, unknown>[]>();
  private partialResizeMode: ImageHandleMode = null;
  private partialSelectionOriginalShapes: unknown[] = [];
  private partialSelectionFragments: Record<string, unknown>[] = [];
  private partialSelectionSplitAttempted = false;
  private partialFragmentStartPositions = new Map<
    Record<string, unknown>,
    { x: number; y: number }
  >();
  private initialPosition = { x: 0, y: 0 };
  private initialScale = 1;
  private initialScaleX = 1;
  private initialScaleY = 1;
  private initialRotation = 0;
  private initialCrop = { x: 0, y: 0, w: 0, h: 0 };
  private dragMode: ImageHandleMode = null;
  private didDrag = false;
  private readonly handlePad = 18;
  private readonly onCanvasPointerMove = (event: PointerEvent) =>
    this.updateCursorFromPointer(event);

  constructor(
    private readonly lc: LCInstance,
    private readonly selectionMode: 'object' | SelectionMode = 'object',
    private readonly onRegionSelectionComplete?: () => void
  ) {
    this.selectCanvas.style.backgroundColor = 'transparent';
  }

  willBecomeActive(): void {
    // Empty
  }

  didBecomeActive(lc: LCInstance): void {
    this.selectedShapes = getSelection(lc);
    this.selectedShape = this.selectedShapes.at(-1) ?? null;
    const unsub1 = lc.on('lc-pointerdown', (e: unknown) =>
      this.onDown(e as { x: number; y: number }, lc)
    );
    const unsub2 = lc.on('lc-pointerdrag', (e: unknown) =>
      this.onDrag(e as { x: number; y: number }, lc)
    );
    const unsub3 = lc.on('lc-pointerup', (e: unknown) =>
      this.onUp(e as { x: number; y: number }, lc)
    );
    const unsubMove = lc.on('lc-pointermove', (e: unknown) => {
      if (this.selectionMode !== 'polygon' || !this.selectionPath.length) return;
      this.polygonPoint = e as { x: number; y: number };
      this.updateSelectionOverlay(lc);
    });
    const unsub4 = lc.on('drawingChange', () => {
      const currentSelection = getSelection(lc).filter((shape) => lc.shapes.includes(shape));
      if (
        currentSelection.length !== this.selectedShapes.length ||
        currentSelection.some((shape, index) => shape !== this.selectedShapes[index])
      ) {
        this.selectedShapes = currentSelection;
        this.selectedShape = currentSelection.at(-1) ?? null;
        setSelection(lc, currentSelection);
        this.updateSelectionOverlay(lc);
      }
      this._drawSelectCanvas(lc);
    });
    const pointerDown = (event: PointerEvent) => {
      this.shiftKeyDown = event.shiftKey;
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') this.shiftKeyDown = true;
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') this.shiftKeyDown = false;
    };
    lc.canvas.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    this._selectShapeUnsubscribe = () => {
      if (typeof unsub1 === 'function') (unsub1 as () => void)();
      if (typeof unsub2 === 'function') (unsub2 as () => void)();
      if (typeof unsub3 === 'function') (unsub3 as () => void)();
      if (typeof unsub4 === 'function') (unsub4 as () => void)();
      if (typeof unsubMove === 'function') unsubMove();
      lc.canvas.removeEventListener('pointermove', this.onCanvasPointerMove);
      lc.canvas.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
    };
    lc.canvas.addEventListener('pointermove', this.onCanvasPointerMove);
    this.setCursor('default');
    this.updateSelectionOverlay(lc);
    this._drawSelectCanvas(lc);
  }

  willBecomeInactive(lc: LCInstance): void {
    if (this._selectShapeUnsubscribe) this._selectShapeUnsubscribe();
    lc.canvas.removeEventListener('pointermove', this.onCanvasPointerMove);
    this.setCursor('default');
    lc.setShapesInProgress([]);
    lc.repaintLayer('main');
    this.dragMode = null;
    this.selectionPath = [];
    this.polygonPoint = null;
    this.selectedShape = null;
    this.selectedShapes = [];
  }

  didBecomeInactive(): void {
    // Empty
  }

  public clearSelection(lc: LCInstance): void {
    const hadSelection =
      this.selectedShape !== null ||
      this.selectedShapes.length > 0 ||
      getSelection(lc).length > 0 ||
      getSelectionRegion(lc) !== null;
    this.selectedShape = null;
    this.selectedShapes = [];
    setSelection(lc, []);
    setSelectionRegion(lc, null);
    this.groupStartPositions.clear();
    this.dragMode = null;
    this.setCursor('default');
    if (!hadSelection) return;
    lc.trigger('shapeSelected', { selectedShape: null });
    lc.setShapesInProgress([]);
    lc.repaintLayer('main');
  }

  private onDown(e: { x: number; y: number }, lc: LCInstance): void {
    if (this.selectionMode === 'polygon') {
      if (!this.selectionPath.length) {
        this.selectionStart = { ...e };
        this.selectionEnd = { ...e };
        this.selectedShape = null;
        this.selectedShapes = [];
        setSelection(lc, []);
        setSelectionRegion(lc, null);
      }
      this.polygonPoint = { ...e };
      this.dragMode = 'marquee';
      this.setCursor('crosshair');
      this.updateSelectionOverlay(lc);
      return;
    }
    this.didDrag = false;
    this.selectionStart = { x: e.x, y: e.y };
    this.selectionEnd = { x: e.x, y: e.y };
    this.selectionPath = [{ x: e.x, y: e.y }];
    this.additiveSelection = this.shiftKeyDown;

    if (this.selectionMode !== 'object') {
      this.selectedShape = null;
      this.selectedShapes = [];
      setSelection(lc, []);
      setSelectionRegion(lc, null);
      this.dragMode = 'marquee';
      this.setCursor('crosshair');
      this.updateSelectionOverlay(lc);
      return;
    }

    const region = getSelectionRegion(lc);
    const regionHandle = region ? this.getGroupHandleMode(e) : null;
    if (
      region &&
      this.selectedShapes.length &&
      (regionHandle || pointInSelection(e, region.start, region.end, region.mode, region.path))
    ) {
      this.partialSelectionRegion = region;
      this.partialSelectionOriginalShapes = [...lc.shapes];
      this.partialSelectionFragments = [];
      this.partialSelectionSplitAttempted = false;
      this.partialResizeMode = regionHandle;
      this.selectedShapes = region.shapes.filter((shape) => lc.shapes.includes(shape));
      this.selectedShape = this.selectedShapes.at(-1) ?? null;
      this.dragMode = 'partial-move';
      this.setCursor('grabbing');
      return;
    }
    if (region) setSelectionRegion(lc, null);

    const groupHandle = this.getGroupHandleMode(e);
    if (groupHandle) {
      this.dragMode = groupHandle;
      this.resizeSnapshots = snapshotShapes(this.selectedShapes);
      this.resizeBounds = getSelectionBounds(this.selectedShapes);
      this.setCursor(this.getCursorForMode(groupHandle, null));
      return;
    }

    if (
      this.selectionMode === 'object' &&
      this.selectedShapes.length === 1 &&
      this.selectedShape &&
      this.selectedShape['className'] === 'Image' &&
      this.selectedShape['image']
    ) {
      const sw =
        ((this.selectedShape['cropWidth'] as number) ||
          (this.selectedShape['image'] as HTMLImageElement).width) *
        (this.selectedShape['scale'] as number) *
        ((this.selectedShape['scaleX'] as number) || 1);
      const sh =
        ((this.selectedShape['cropHeight'] as number) ||
          (this.selectedShape['image'] as HTMLImageElement).height) *
        (this.selectedShape['scale'] as number) *
        ((this.selectedShape['scaleY'] as number) || 1);
      const { lx, ly } = ptToLocal(e.x, e.y, this.selectedShape);

      this.dragMode = this.adjustImageHandleMode(
        this.getImageHandleMode(lx, ly, sw, sh),
        this.shiftKeyDown
      );

      if (this.dragMode) {
        this.saveInitialState();
        this.setCursor(this.getCursorForMode(this.dragMode, this.selectedShape));
        if (this.dragMode === 'move') {
          const cx = (this.selectedShape['x'] as number) + sw / 2;
          const cy = (this.selectedShape['y'] as number) + sh / 2;
          this.dragOffset = { x: e.x - cx, y: e.y - cy };
        }
        return;
      }
    }

    this.dragMode = null;
    const shapeIndex = this.selectCtx ? this._getPixel(e.x, e.y, lc, this.selectCtx) : null;

    if (shapeIndex !== null && lc.shapes[shapeIndex]) {
      const hitShape = lc.shapes[shapeIndex] as Record<string, unknown>;
      const isAlreadySelected = this.selectedShapes.includes(hitShape);
      if (this.selectionMode === 'object') {
        if (this.shiftKeyDown) {
          this.selectedShapes = isAlreadySelected
            ? this.selectedShapes.filter((shape) => shape !== hitShape)
            : [...this.selectedShapes, hitShape];
        } else if (!isAlreadySelected) {
          this.selectedShapes = [hitShape];
        }
      } else {
        this.selectedShapes = [hitShape];
      }
      setSelection(lc, this.selectedShapes);

      if (!this.selectedShapes.includes(hitShape)) {
        this.selectedShape = this.selectedShapes.at(-1) ?? null;
        lc.trigger('shapeSelected', { selectedShape: this.selectedShape });
        this.updateSelectionOverlay(lc);
        return;
      }

      this.selectedShape = hitShape;
      lc.trigger('shapeSelected', { selectedShape: this.selectedShape });

      if (
        this.selectedShapes.length === 1 &&
        typeof this.selectedShape['getBoundingRect'] === 'function'
      ) {
        const br = (this.selectedShape['getBoundingRect'] as () => { x: number; y: number })();
        this.dragOffset = { x: e.x - br.x, y: e.y - br.y };
      }

      this.saveInitialState();
      this.groupStartPositions.clear();
      for (const shape of this.selectedShapes) {
        this.groupStartPositions.set(shape, this.getShapePosition(shape));
      }

      if (this.selectedShapes.length === 1 && this.selectedShape['className'] === 'Image') {
        const sw =
          ((this.selectedShape['cropWidth'] as number) ||
            (this.selectedShape['image'] as HTMLImageElement).width) *
          (this.selectedShape['scale'] as number) *
          ((this.selectedShape['scaleX'] as number) || 1);
        const sh =
          ((this.selectedShape['cropHeight'] as number) ||
            (this.selectedShape['image'] as HTMLImageElement).height) *
          (this.selectedShape['scale'] as number) *
          ((this.selectedShape['scaleY'] as number) || 1);
        const cx = (this.selectedShape['x'] as number) + sw / 2;
        const cy = (this.selectedShape['y'] as number) + sh / 2;
        this.dragOffset = { x: e.x - cx, y: e.y - cy };
      }
      this.dragMode = 'move';
      this.setCursor(this.getCursorForMode('move', this.selectedShape));
      this.updateSelectionOverlay(lc);
    } else {
      if (this.selectionMode === 'object' && !this.shiftKeyDown) {
        this.selectedShape = null;
        this.selectedShapes = [];
        setSelection(lc, []);
      }
      this.dragMode = 'marquee';
      this.setCursor('crosshair');
      lc.trigger('shapeSelected', { selectedShape: null });
      this.updateSelectionOverlay(lc);
    }
  }

  private saveInitialState(): void {
    if (!this.selectedShape) return;
    this.initialPosition = this.getShapePosition(this.selectedShape);
    this.initialScale = (this.selectedShape['scale'] as number) || 1;
    this.initialScaleX = (this.selectedShape['scaleX'] as number) || 1;
    this.initialScaleY = (this.selectedShape['scaleY'] as number) || 1;
    this.initialRotation = (this.selectedShape['rotation'] as number) || 0;
    this.initialCrop = {
      x: (this.selectedShape['cropX'] as number) || 0,
      y: (this.selectedShape['cropY'] as number) || 0,
      w:
        (this.selectedShape['cropWidth'] as number) ||
        (this.selectedShape['image'] ? (this.selectedShape['image'] as HTMLImageElement).width : 0),
      h:
        (this.selectedShape['cropHeight'] as number) ||
        (this.selectedShape['image']
          ? (this.selectedShape['image'] as HTMLImageElement).height
          : 0),
    };
  }

  private updateSelectionOverlay(lc: LCInstance): void {
    const createShape = (window as unknown as { LC: Record<string, unknown> }).LC[
      'createShape'
    ] as (name: string, args: Record<string, unknown>) => unknown;
    if (this.dragMode === 'marquee') {
      lc.setShapesInProgress([
        createShape('SelectionRegionOverlay', {
          start: this.selectionStart,
          end: this.selectionEnd,
          mode: this.selectionMode === 'object' ? 'rectangle' : this.selectionMode,
          path:
            this.selectionMode === 'polygon' && this.polygonPoint
              ? [...this.selectionPath, this.polygonPoint]
              : this.selectionPath,
        }),
      ]);
    } else if (getSelectionRegion(lc) && this.dragMode !== 'partial-move') {
      lc.setShapesInProgress([
        createShape('SelectionGroupOverlay', { shapes: this.getTransformShapes(lc) }),
      ]);
    } else if (this.selectedShapes.length === 0) {
      lc.setShapesInProgress([]);
    } else if (this.selectedShapes.length === 1 && this.selectedShape?.['className'] === 'Image') {
      lc.setShapesInProgress([
        createShape('ImageSelectionOverlay', {
          shape: this.selectedShape,
        }),
      ]);
    } else {
      lc.setShapesInProgress([
        createShape('SelectionGroupOverlay', { shapes: this.selectedShapes }),
      ]);
    }
    lc.repaintLayer('main');
  }

  private onDrag(e: { x: number; y: number }, lc: LCInstance): void {
    if (this.selectionMode === 'polygon') {
      this.polygonPoint = { ...e };
      this.updateSelectionOverlay(lc);
      return;
    }
    if (this.dragMode === 'marquee') {
      this.didDrag = true;
      this.selectionEnd = { x: e.x, y: e.y };
      if (this.selectionMode === 'lasso') {
        const previous = this.selectionPath.at(-1);
        if (!previous || Math.hypot(e.x - previous.x, e.y - previous.y) >= 2) {
          this.selectionPath.push({ x: e.x, y: e.y });
        }
      }
      this.updateSelectionOverlay(lc);
      return;
    }
    if (this.dragMode === 'partial-move') {
      this.didDrag = true;
      if (!this.partialSelectionSplitAttempted) {
        this.partialSelectionSplitAttempted = true;
        this.partialSelectionFragments = this.splitPartialSelection(lc);
        this.partialFragmentStartPositions = new Map(
          this.partialSelectionFragments.map((shape) => [shape, this.getShapePosition(shape)])
        );
        this.resizeSnapshots = snapshotShapes(this.partialSelectionFragments);
        this.resizeBounds = getSelectionBounds(this.partialSelectionFragments);
      }
      if (this.partialResizeMode) {
        this.resizeSelection(e, this.partialResizeMode);
        this.updateSelectionOverlay(lc);
        return;
      }
      const deltaX = e.x - this.selectionStart.x;
      const deltaY = e.y - this.selectionStart.y;
      for (const [shape, start] of this.partialFragmentStartPositions) {
        this.setShapePosition(shape, { x: start.x + deltaX, y: start.y + deltaY });
      }
      this.updateSelectionOverlay(lc);
      return;
    }
    if (!this.selectedShape || !this.dragMode) return;
    this.didDrag = true;

    if (this.dragMode.startsWith('group-')) {
      this.resizeSelection(e, this.dragMode);
      this.updateSelectionOverlay(lc);
      return;
    }

    if (this.dragMode === 'move') {
      if (this.selectedShapes.length > 1) {
        const deltaX = e.x - this.selectionStart.x;
        const deltaY = e.y - this.selectionStart.y;
        for (const shape of this.selectedShapes) {
          const start = this.groupStartPositions.get(shape);
          if (start) {
            this.setShapePosition(shape, { x: start.x + deltaX, y: start.y + deltaY });
          }
        }
      } else if (this.selectedShape['className'] === 'Image') {
        const sw =
          ((this.selectedShape['cropWidth'] as number) ||
            (this.selectedShape['image'] as HTMLImageElement).width) *
          (this.selectedShape['scale'] as number) *
          ((this.selectedShape['scaleX'] as number) || 1);
        const sh =
          ((this.selectedShape['cropHeight'] as number) ||
            (this.selectedShape['image'] as HTMLImageElement).height) *
          (this.selectedShape['scale'] as number) *
          ((this.selectedShape['scaleY'] as number) || 1);

        this.selectedShape['x'] = e.x - this.dragOffset.x - sw / 2;
        this.selectedShape['y'] = e.y - this.dragOffset.y - sh / 2;
      } else {
        if (typeof this.selectedShape['setUpperLeft'] === 'function') {
          (this.selectedShape['setUpperLeft'] as (pos: { x: number; y: number }) => void).call(
            this.selectedShape,
            {
              x: e.x - this.dragOffset.x,
              y: e.y - this.dragOffset.y,
            }
          );
        } else {
          this.selectedShape['x'] = e.x - this.dragOffset.x;
          this.selectedShape['y'] = e.y - this.dragOffset.y;
        }
      }
    } else if (this.selectedShape['className'] === 'Image' && this.selectedShape['image']) {
      const baseW =
        (this.selectedShape['cropWidth'] as number) ||
        (this.selectedShape['image'] as HTMLImageElement).width;
      const baseH =
        (this.selectedShape['cropHeight'] as number) ||
        (this.selectedShape['image'] as HTMLImageElement).height;
      const baseScale = (this.selectedShape['scale'] as number) || 1;
      const baseScaleX = (this.selectedShape['scaleX'] as number) || 1;
      const baseScaleY = (this.selectedShape['scaleY'] as number) || 1;
      const cos = Math.cos(-(this.selectedShape['rotation'] as number) || 0);
      const sin = Math.sin(-(this.selectedShape['rotation'] as number) || 0);

      if (this.dragMode === 'rotate') {
        const anchorG = getGlobalPoint(this.selectedShape, 0.5, 0.5);
        const angle = Math.atan2(e.y - anchorG.y, e.x - anchorG.x);
        this.selectedShape['rotation'] = angle + Math.PI / 2;
        setGlobalPointAnchor(this.selectedShape, 0.5, 0.5, anchorG);
      } else if (this.dragMode.startsWith('scale-unlinked-')) {
        const anchorMap = {
          'scale-unlinked-br': [0, 0],
          'scale-unlinked-tr': [0, 1],
          'scale-unlinked-tl': [1, 1],
          'scale-unlinked-bl': [1, 0],
        } as const;
        const [anchorX, anchorY] =
          anchorMap[this.dragMode as keyof typeof anchorMap] ?? anchorMap['scale-unlinked-br'];
        const anchorG = getGlobalPoint(this.selectedShape, anchorX, anchorY);
        const dx = e.x - anchorG.x;
        const dy = e.y - anchorG.y;
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        const positiveX = anchorX === 0 ? lx : -lx;
        const positiveY = anchorY === 0 ? ly : -ly;
        this.selectedShape['scaleX'] = Math.max(0.01, positiveX / (baseW * baseScale));
        this.selectedShape['scaleY'] = Math.max(0.01, positiveY / (baseH * baseScale));
        setGlobalPointAnchor(this.selectedShape, anchorX, anchorY, anchorG);
      } else if (this.dragMode === 'stretch-r' || this.dragMode === 'stretch-l') {
        const anchorX = this.dragMode === 'stretch-r' ? 0 : 1;
        const anchorG = getGlobalPoint(this.selectedShape, anchorX, 0.5);
        const dx = e.x - anchorG.x;
        const dy = e.y - anchorG.y;
        const lx = dx * cos - dy * sin;
        const signedWidth = anchorX === 0 ? lx : -lx;
        this.selectedShape['scaleX'] = Math.max(0.01, signedWidth / (baseW * baseScale));
        setGlobalPointAnchor(this.selectedShape, anchorX, 0.5, anchorG);
      } else if (this.dragMode === 'stretch-b' || this.dragMode === 'stretch-t') {
        const anchorY = this.dragMode === 'stretch-b' ? 0 : 1;
        const anchorG = getGlobalPoint(this.selectedShape, 0.5, anchorY);
        const dx = e.x - anchorG.x;
        const dy = e.y - anchorG.y;
        const ly = dx * sin + dy * cos;
        const signedHeight = anchorY === 0 ? ly : -ly;
        this.selectedShape['scaleY'] = Math.max(0.01, signedHeight / (baseH * baseScale));
        setGlobalPointAnchor(this.selectedShape, 0.5, anchorY, anchorG);
      } else if (this.dragMode === 'br') {
        const anchorG = getGlobalPoint(this.selectedShape, 0, 0);
        const dx = e.x - anchorG.x,
          dy = e.y - anchorG.y;
        const lx = dx * cos - dy * sin,
          ly = dx * sin + dy * cos;
        const factor = Math.max(
          lx / (baseW * baseScale * baseScaleX),
          ly / (baseH * baseScale * baseScaleY)
        );
        this.selectedShape['scale'] = Math.max(0.01, baseScale * factor);
        setGlobalPointAnchor(this.selectedShape, 0, 0, anchorG);
      } else if (this.dragMode === 'tr') {
        const anchorG = getGlobalPoint(this.selectedShape, 0, 1);
        const dx = e.x - anchorG.x,
          dy = e.y - anchorG.y;
        const lx = dx * cos - dy * sin,
          ly = dx * sin + dy * cos;
        const factor = Math.max(
          lx / (baseW * baseScale * baseScaleX),
          -ly / (baseH * baseScale * baseScaleY)
        );
        this.selectedShape['scale'] = Math.max(0.01, baseScale * factor);
        setGlobalPointAnchor(this.selectedShape, 0, 1, anchorG);
      } else if (this.dragMode === 'tl') {
        const anchorG = getGlobalPoint(this.selectedShape, 1, 1);
        const dx = e.x - anchorG.x,
          dy = e.y - anchorG.y;
        const lx = dx * cos - dy * sin,
          ly = dx * sin + dy * cos;
        const factor = Math.max(
          -lx / (baseW * baseScale * baseScaleX),
          -ly / (baseH * baseScale * baseScaleY)
        );
        this.selectedShape['scale'] = Math.max(0.01, baseScale * factor);
        setGlobalPointAnchor(this.selectedShape, 1, 1, anchorG);
      } else if (this.dragMode === 'bl') {
        const anchorG = getGlobalPoint(this.selectedShape, 1, 0);
        const dx = e.x - anchorG.x,
          dy = e.y - anchorG.y;
        const lx = dx * cos - dy * sin,
          ly = dx * sin + dy * cos;
        const factor = Math.max(
          -lx / (baseW * baseScale * baseScaleX),
          ly / (baseH * baseScale * baseScaleY)
        );
        this.selectedShape['scale'] = Math.max(0.01, baseScale * factor);
        setGlobalPointAnchor(this.selectedShape, 1, 0, anchorG);
      } else if (this.dragMode === 'crop-r') {
        const anchorG = getGlobalPoint(this.selectedShape, 0, 0.5);
        const dx = e.x - anchorG.x,
          dy = e.y - anchorG.y;
        const lx = dx * cos - dy * sin;
        let newCW = lx / (baseScale * baseScaleX);
        newCW = Math.min(
          Math.max(1, newCW),
          (this.selectedShape['image'] as HTMLImageElement).width -
            (this.selectedShape['cropX'] as number)
        );
        this.selectedShape['cropWidth'] = newCW;
        setGlobalPointAnchor(this.selectedShape, 0, 0.5, anchorG);
      } else if (this.dragMode === 'crop-l') {
        const anchorG = getGlobalPoint(this.selectedShape, 1, 0.5);
        const dx = e.x - anchorG.x,
          dy = e.y - anchorG.y;
        const lx = dx * cos - dy * sin;
        const newCW = -lx / (baseScale * baseScaleX);
        let deltaX = (this.selectedShape['cropWidth'] as number) - newCW;
        let newCX = (this.selectedShape['cropX'] as number) + deltaX;
        let resultCW = newCW;
        if (newCX < 0) {
          deltaX = -(this.selectedShape['cropX'] as number);
          newCX = 0;
          resultCW = (this.selectedShape['cropWidth'] as number) - deltaX;
        }
        if (resultCW < 1) {
          resultCW = 1;
          newCX = this.initialCrop.x + this.initialCrop.w - 1;
        }
        this.selectedShape['cropX'] = newCX;
        this.selectedShape['cropWidth'] = resultCW;
        setGlobalPointAnchor(this.selectedShape, 1, 0.5, anchorG);
      } else if (this.dragMode === 'crop-b') {
        const anchorG = getGlobalPoint(this.selectedShape, 0.5, 0);
        const dx = e.x - anchorG.x,
          dy = e.y - anchorG.y;
        const ly = dx * sin + dy * cos;
        let newCH = ly / (baseScale * baseScaleY);
        newCH = Math.min(
          Math.max(1, newCH),
          (this.selectedShape['image'] as HTMLImageElement).height -
            (this.selectedShape['cropY'] as number)
        );
        this.selectedShape['cropHeight'] = newCH;
        setGlobalPointAnchor(this.selectedShape, 0.5, 0, anchorG);
      } else if (this.dragMode === 'crop-t') {
        const anchorG = getGlobalPoint(this.selectedShape, 0.5, 1);
        const dx = e.x - anchorG.x,
          dy = e.y - anchorG.y;
        const ly = dx * sin + dy * cos;
        const newCH = -ly / (baseScale * baseScaleY);
        let deltaY = (this.selectedShape['cropHeight'] as number) - newCH;
        let newCY = (this.selectedShape['cropY'] as number) + deltaY;
        let resultCH = newCH;
        if (newCY < 0) {
          deltaY = -(this.selectedShape['cropY'] as number);
          newCY = 0;
          resultCH = (this.selectedShape['cropHeight'] as number) - deltaY;
        }
        if (resultCH < 1) {
          resultCH = 1;
          newCY = this.initialCrop.y + this.initialCrop.h - 1;
        }
        this.selectedShape['cropY'] = newCY;
        this.selectedShape['cropHeight'] = resultCH;
        setGlobalPointAnchor(this.selectedShape, 0.5, 1, anchorG);
      }
    }

    this.updateSelectionOverlay(lc);
  }

  private onUp(_: { x: number; y: number }, lc: LCInstance): void {
    if (this.selectionMode === 'polygon') {
      const first = this.selectionPath[0];
      if (
        first &&
        this.selectionPath.length >= 3 &&
        Math.abs(_.x - first.x) + Math.abs(_.y - first.y) < 10
      ) {
        this.didDrag = true;
        this.polygonPoint = null;
        this.selectionStart = {
          x: Math.min(...this.selectionPath.map((point) => point.x)),
          y: Math.min(...this.selectionPath.map((point) => point.y)),
        };
        this.selectionEnd = {
          x: Math.max(...this.selectionPath.map((point) => point.x)),
          y: Math.max(...this.selectionPath.map((point) => point.y)),
        };
      } else {
        this.selectionPath.push({ ..._ });
        this.polygonPoint = { ..._ };
        this.updateSelectionOverlay(lc);
        return;
      }
    } else if (this.dragMode === 'marquee') {
      this.selectionEnd = { ..._ };
      this.didDrag ||= _.x !== this.selectionStart.x || _.y !== this.selectionStart.y;
    } else if (this.didDrag) {
      this.onDrag(_, lc);
    }
    if (this.dragMode === 'partial-move') {
      if (this.didDrag && this.partialSelectionFragments.length) {
        const after = [...lc.shapes];
        setSelectionRegion(lc, null);
        lc.execute(
          new PartialSelectionMoveAction(
            lc,
            this.partialSelectionOriginalShapes,
            after,
            this.partialSelectionRegion,
            this.partialSelectionFragments
          )
        );
        lc.trigger('drawingChange', {});
      }
      this.partialSelectionRegion = null;
      this.partialResizeMode = null;
      this.resizeSnapshots = new Map();
      this.partialSelectionOriginalShapes = [];
      this.partialSelectionFragments = [];
      this.partialSelectionSplitAttempted = false;
      this.partialFragmentStartPositions.clear();
      this.didDrag = false;
      this.dragMode = null;
      this.updateSelectionOverlay(lc);
      this.setCursor('default');
      return;
    }

    if (this.dragMode === 'marquee') {
      if (this.selectionMode === 'lasso') {
        this.selectionPath.push(this.selectionEnd);
      }
      if (this.selectionMode === 'lasso' && this.selectionPath.length) {
        this.selectionStart = {
          x: Math.min(...this.selectionPath.map((point) => point.x)),
          y: Math.min(...this.selectionPath.map((point) => point.y)),
        };
        this.selectionEnd = {
          x: Math.max(...this.selectionPath.map((point) => point.x)),
          y: Math.max(...this.selectionPath.map((point) => point.y)),
        };
      }
      const found = this.findShapesInSelection(lc);
      if (this.selectionMode === 'object') {
        this.selectedShapes = this.additiveSelection
          ? [...new Set([...this.selectedShapes, ...found])]
          : found;
        setSelectionRegion(lc, null);
      } else {
        this.selectedShapes = this.didDrag ? found : [];
        setSelectionRegion(
          lc,
          this.selectedShapes.length
            ? {
                start: this.selectionStart,
                end: this.selectionEnd,
                mode: this.selectionMode,
                path: [...this.selectionPath],
                shapes: this.selectedShapes,
              }
            : null
        );
      }
      this.selectedShape = this.selectedShapes.at(-1) ?? null;
      setSelection(lc, this.selectedShapes);
      this.dragMode = null;
      this.setCursor('default');
      lc.trigger('shapeSelected', { selectedShape: this.selectedShape });
      this.updateSelectionOverlay(lc);
      lc.trigger('drawingChange', {});
      if (this.selectionMode !== 'object') this.onRegionSelectionComplete?.();
      return;
    }

    if (this.dragMode?.startsWith('group-')) {
      if (this.didDrag) {
        lc.execute(new ResizeAction(lc, this.resizeSnapshots, snapshotShapes(this.selectedShapes)));
        lc.trigger('drawingChange', {});
      }
      this.resizeSnapshots = new Map();
      this.dragMode = null;
      this.didDrag = false;
      this.updateSelectionOverlay(lc);
      this.setCursor('default');
      return;
    }

    if (this.selectedShapes.length > 1 && this.didDrag) {
      this.didDrag = false;
      const to = new Map(
        this.selectedShapes.map((shape) => [shape, this.getShapePosition(shape)] as const)
      );
      if (
        this.selectedShapes.some((shape) => {
          const before = this.groupStartPositions.get(shape);
          const after = to.get(shape);
          return !!before && !!after && (before.x !== after.x || before.y !== after.y);
        })
      ) {
        const action = new MultiShapeTransformAction(this.lc, this.groupStartPositions, to);
        lc.execute(action);
        lc.trigger('drawingChange', {});
      }
      this.groupStartPositions.clear();
      this.updateSelectionOverlay(lc);
      this.dragMode = null;
      this.setCursor('default');
      return;
    }

    if (this.didDrag && this.selectedShape) {
      this.didDrag = false;

      const finalPosition = this.getShapePosition(this.selectedShape);
      const finalScale = (this.selectedShape['scale'] as number) || 1;
      const finalScaleX = (this.selectedShape['scaleX'] as number) || 1;
      const finalScaleY = (this.selectedShape['scaleY'] as number) || 1;
      const finalRot = (this.selectedShape['rotation'] as number) || 0;
      const finalCrop = {
        x: (this.selectedShape['cropX'] as number) || 0,
        y: (this.selectedShape['cropY'] as number) || 0,
        w: (this.selectedShape['cropWidth'] as number) || 0,
        h: (this.selectedShape['cropHeight'] as number) || 0,
      };

      if (
        finalPosition.x !== this.initialPosition.x ||
        finalPosition.y !== this.initialPosition.y ||
        finalScale !== this.initialScale ||
        finalScaleX !== this.initialScaleX ||
        finalScaleY !== this.initialScaleY ||
        finalRot !== this.initialRotation ||
        finalCrop.x !== this.initialCrop.x ||
        finalCrop.y !== this.initialCrop.y ||
        finalCrop.w !== this.initialCrop.w ||
        finalCrop.h !== this.initialCrop.h
      ) {
        const isImageShape = this.selectedShape['className'] === 'Image';
        const fromState: Record<string, unknown> = {
          x: this.initialPosition.x,
          y: this.initialPosition.y,
        };
        const toState: Record<string, unknown> = {
          x: finalPosition.x,
          y: finalPosition.y,
        };

        if (isImageShape) {
          fromState['scale'] = this.initialScale;
          fromState['scaleX'] = this.initialScaleX;
          fromState['scaleY'] = this.initialScaleY;
          fromState['rotation'] = this.initialRotation;
          fromState['cropX'] = this.initialCrop.x;
          fromState['cropY'] = this.initialCrop.y;
          fromState['cropWidth'] = this.initialCrop.w;
          fromState['cropHeight'] = this.initialCrop.h;

          toState['scale'] = finalScale;
          toState['scaleX'] = finalScaleX;
          toState['scaleY'] = finalScaleY;
          toState['rotation'] = finalRot;
          toState['cropX'] = finalCrop.x;
          toState['cropY'] = finalCrop.y;
          toState['cropWidth'] = finalCrop.w;
          toState['cropHeight'] = finalCrop.h;
        }

        const action = new TransformAction(lc, this.selectedShape, fromState, toState);

        const activeLc = lc as unknown as Record<string, unknown>;
        if (typeof activeLc['execute'] === 'function') {
          (activeLc['execute'] as (a: unknown) => void)(action);
        } else {
          action.do();
        }

        lc.trigger('shapeMoved', { shape: this.selectedShape });
        lc.trigger('drawingChange', {});
      }

      lc.repaintLayer('main');
      this._drawSelectCanvas(lc);
    }

    this.dragMode = null;
    this.setCursor(
      this.getCursorForMode(this.getHoverModeAtPoint(_, this.selectedShape), this.selectedShape)
    );
  }

  private getImageHandleMode(lx: number, ly: number, sw: number, sh: number): ImageHandleMode {
    const pad = this.handlePad;
    if (Math.abs(lx - sw / 2) < pad && Math.abs(ly + 25) < pad) return 'rotate';
    if (Math.abs(lx) < pad && Math.abs(ly) < pad) return 'tl';
    if (Math.abs(lx - sw) < pad && Math.abs(ly) < pad) return 'tr';
    if (Math.abs(lx) < pad && Math.abs(ly - sh) < pad) return 'bl';
    if (Math.abs(lx - sw) < pad && Math.abs(ly - sh) < pad) return 'br';
    if (Math.abs(lx - sw / 2) < pad && Math.abs(ly) < pad) return 'crop-t';
    if (Math.abs(lx - sw / 2) < pad && Math.abs(ly - sh) < pad) return 'crop-b';
    if (Math.abs(lx) < pad && Math.abs(ly - sh / 2) < pad) return 'crop-l';
    if (Math.abs(lx - sw) < pad && Math.abs(ly - sh / 2) < pad) return 'crop-r';
    if (lx >= 0 && lx <= sw && ly >= 0 && ly <= sh) return 'move';
    return null;
  }

  private getGroupHandleMode(point: { x: number; y: number }): ImageHandleMode {
    const region = getSelectionRegion(this.lc);
    if (
      !this.selectedShapes.length ||
      (!region && this.selectedShapes.length === 1 && this.selectedShape?.['className'] === 'Image')
    )
      return null;
    const { x, y, width, height } = getSelectionBounds(this.getTransformShapes(this.lc));
    if (width <= 0 || height <= 0) return null;
    if (Math.hypot(point.x - x - width / 2, point.y - y + 25) < this.handlePad) {
      return 'group-rotate';
    }
    const corners = [
      { x, y, mode: 'group-tl' },
      { x: x + width, y, mode: 'group-tr' },
      { x, y: y + height, mode: 'group-bl' },
      { x: x + width, y: y + height, mode: 'group-br' },
    ] as const;
    return (
      corners.find(
        (corner) =>
          Math.hypot(point.x - corner.x, point.y - corner.y) <
          Math.min(this.handlePad, width / 4, height / 4)
      )?.mode ?? null
    );
  }

  private resizeSelection(point: { x: number; y: number }, mode: ImageHandleMode): void {
    if (!mode) return;
    const { x, y, width, height } = this.resizeBounds;
    if (mode === 'group-rotate') {
      const center = { x: x + width / 2, y: y + height / 2 };
      rotateShapes(
        this.resizeSnapshots,
        center,
        Math.atan2(point.y - center.y, point.x - center.x) -
          Math.atan2(this.selectionStart.y - center.y, this.selectionStart.x - center.x)
      );
      return;
    }
    if (width <= 0 || height <= 0) return;
    const left = mode.endsWith('tl') || mode.endsWith('bl');
    const top = mode.endsWith('tl') || mode.endsWith('tr');
    const anchor = { x: left ? x + width : x, y: top ? y + height : y };
    let scaleX = Math.max(0.01, ((point.x - anchor.x) * (left ? -1 : 1)) / width);
    let scaleY = Math.max(0.01, ((point.y - anchor.y) * (top ? -1 : 1)) / height);
    if (!this.shiftKeyDown) scaleX = scaleY = Math.max(scaleX, scaleY);
    resizeShapes(this.resizeSnapshots, anchor, scaleX, scaleY);
  }

  private getTransformShapes(lc: LCInstance): Record<string, unknown>[] {
    const region = getSelectionRegion(lc);
    if (!region) return this.selectedShapes;
    const cached = this.partialPreviews.get(region);
    if (cached) return cached;
    const fragments = region.shapes.flatMap((shape) => {
      const bounds = getShapeBounds(shape);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return [];
      const rendered = this.renderSelectionShape(shape, bounds);
      return this.createImageShapes(
        this.applySelectionPath(rendered, bounds, region, true),
        bounds
      );
    });
    this.partialPreviews.set(region, fragments);
    return fragments;
  }

  private renderSelectionShape(
    shape: Record<string, unknown>,
    bounds: SelectionBounds
  ): HTMLCanvasElement {
    if (!LC.renderSnapshotToImage) {
      throw new Error('LiterallyCanvas image rendering is unavailable for partial selection.');
    }
    return LC.renderSnapshotToImage(
      {
        shapes: [LC.shapeToJSON(shape)],
        backgroundShapes: [],
        colors: { background: 'transparent' },
        imageSize: { width: 'infinite', height: 'infinite' },
      },
      { rect: bounds, scale: 1, includeWatermark: false }
    );
  }

  private adjustImageHandleMode(mode: ImageHandleMode, shiftKey: boolean): ImageHandleMode {
    if (!mode) return null;
    if (mode === 'br' || mode === 'tr' || mode === 'tl' || mode === 'bl') {
      return shiftKey ? `scale-unlinked-${mode}` : mode;
    }
    if (mode === 'crop-r' || mode === 'crop-l') {
      return shiftKey ? mode : (mode.replace('crop-', 'stretch-') as ImageHandleMode);
    }
    if (mode === 'crop-t' || mode === 'crop-b') {
      return shiftKey ? mode : (mode.replace('crop-', 'stretch-') as ImageHandleMode);
    }
    return mode;
  }

  private getHoverModeAtPoint(
    point: { x: number; y: number },
    shape: Record<string, unknown> | null
  ): ImageHandleMode {
    const groupHandle = this.getGroupHandleMode(point);
    if (groupHandle) return groupHandle;
    if (!shape || shape['className'] !== 'Image' || !shape['image']) {
      return null;
    }

    const { lx, ly, sw, sh } = ptToLocal(point.x, point.y, shape);
    return this.getImageHandleMode(lx, ly, sw, sh);
  }

  private getCursorForMode(mode: ImageHandleMode, shape: Record<string, unknown> | null): string {
    if (!mode) return 'default';
    if (mode === 'group-rotate') return getRotateCursor();
    if (mode.startsWith('group-')) {
      return mode === 'group-tl' || mode === 'group-br' ? 'nwse-resize' : 'nesw-resize';
    }
    const rotation = shape ? (shape['rotation'] as number) || 0 : 0;

    if (mode === 'move') {
      return this.dragMode === 'move' ? 'grabbing' : 'grab';
    }

    if (mode === 'rotate') {
      return getRotateCursor();
    }

    if (mode === 'crop-l' || mode === 'crop-r' || mode === 'stretch-l' || mode === 'stretch-r') {
      return getResizeCursorForAngle(rotation);
    }

    if (mode === 'crop-t' || mode === 'crop-b' || mode === 'stretch-t' || mode === 'stretch-b') {
      return getResizeCursorForAngle(rotation + Math.PI / 2);
    }

    if (
      mode === 'tl' ||
      mode === 'br' ||
      mode === 'scale-unlinked-tl' ||
      mode === 'scale-unlinked-br'
    ) {
      return getResizeCursorForAngle(rotation + Math.PI / 4);
    }

    if (
      mode === 'tr' ||
      mode === 'bl' ||
      mode === 'scale-unlinked-tr' ||
      mode === 'scale-unlinked-bl'
    ) {
      return getResizeCursorForAngle(rotation - Math.PI / 4);
    }

    return 'default';
  }

  private updateCursorFromPointer(event: PointerEvent): void {
    if (this.dragMode) {
      this.setCursor(this.getCursorForMode(this.dragMode, this.selectedShape));
      return;
    }

    const point = this.pointerEventToDrawingPoint(event);
    const mode = this.getHoverModeAtPoint(point, this.selectedShape);
    this.setCursor(this.getCursorForMode(mode, this.selectedShape));
  }

  private pointerEventToDrawingPoint(event: PointerEvent): { x: number; y: number } {
    const activeLc = this.lc as unknown as Record<string, unknown>;

    if (typeof activeLc['clientCoordsToDrawingCoords'] === 'function') {
      return (
        activeLc['clientCoordsToDrawingCoords'] as (
          x: number,
          y: number
        ) => { x: number; y: number }
      )(event.clientX, event.clientY);
    }

    const rect = this.lc.canvas.getBoundingClientRect();
    const x =
      (event.clientX - rect.left - this.lc.position.x / (this.lc.backingScale || 1)) /
      this.lc.scale;
    const y =
      (event.clientY - rect.top - this.lc.position.y / (this.lc.backingScale || 1)) / this.lc.scale;
    return { x, y };
  }

  private setCursor(cursor: string): void {
    this.lc.canvas.style.cursor = cursor;
  }

  private getShapePosition(shape: Record<string, unknown>): { x: number; y: number } {
    // Image shapes store top-left directly in x/y; using rotated bounding-box coords causes jump.
    if (shape['className'] === 'Image' || (shape['x'] !== undefined && shape['y'] !== undefined)) {
      return {
        x: (shape['x'] as number) || 0,
        y: (shape['y'] as number) || 0,
      };
    }

    if (typeof shape['getBoundingRect'] === 'function') {
      const br = (shape['getBoundingRect'] as () => { x: number; y: number })();
      return { x: br.x, y: br.y };
    }

    return { x: 0, y: 0 };
  }

  public getSelectedShapes(): readonly Record<string, unknown>[] {
    return this.selectedShapes;
  }

  public selectShapes(shapes: Record<string, unknown>[], lc: LCInstance): void {
    this.selectedShapes = shapes;
    this.selectedShape = shapes.at(-1) ?? null;
    setSelection(lc, shapes);
    this.updateSelectionOverlay(lc);
  }

  private setShapePosition(
    shape: Record<string, unknown>,
    position: { x: number; y: number }
  ): void {
    if (typeof shape['setUpperLeft'] === 'function') {
      (shape['setUpperLeft'] as (point: { x: number; y: number }) => void).call(shape, position);
    } else {
      shape['x'] = position.x;
      shape['y'] = position.y;
    }
  }

  private findShapesInSelection(lc: LCInstance): Record<string, unknown>[] {
    if (!this.selectCtx) return [];
    const minX = Math.floor(Math.min(this.selectionStart.x, this.selectionEnd.x));
    const maxX = Math.ceil(Math.max(this.selectionStart.x, this.selectionEnd.x));
    const minY = Math.floor(Math.min(this.selectionStart.y, this.selectionEnd.y));
    const maxY = Math.ceil(Math.max(this.selectionStart.y, this.selectionEnd.y));
    const shapes = lc.shapes as Record<string, unknown>[];
    const matches = new Set<number>();
    for (let index = 0; index < shapes.length; index += 1) {
      const shape = shapes[index];
      const bounds = getShapeBounds(shape);
      if (!bounds) continue;
      if (this.selectionMode === 'object') {
        if (
          bounds.x <= maxX &&
          bounds.x + bounds.width >= minX &&
          bounds.y <= maxY &&
          bounds.y + bounds.height >= minY
        ) {
          matches.add(index);
        }
        continue;
      }
      const left = Math.max(minX, Math.floor(bounds.x));
      const right = Math.min(maxX, Math.ceil(bounds.x + bounds.width));
      const top = Math.max(minY, Math.floor(bounds.y));
      const bottom = Math.min(maxY, Math.ceil(bounds.y + bounds.height));
      if (right <= left || bottom <= top) continue;
      const area = Math.max(1, (right - left) * (bottom - top));
      const stride = Math.max(1, Math.ceil(Math.sqrt(area / 1600)));
      for (let y = top; y <= bottom; y += stride) {
        for (let x = left; x <= right; x += stride) {
          if (
            pointInSelection(
              { x, y },
              this.selectionStart,
              this.selectionEnd,
              this.selectionMode,
              this.selectionPath
            ) &&
            this._getPixel(x, y, lc, this.selectCtx) === index
          ) {
            matches.add(index);
            y = bottom + 1;
            break;
          }
        }
      }
    }
    return [...matches].sort((a, b) => a - b).map((index) => shapes[index]);
  }

  private splitPartialSelection(lc: LCInstance): Record<string, unknown>[] {
    const region = this.partialSelectionRegion;
    if (!region) return [];
    const selectedSet = new Set(region.shapes);
    const replacements = new Map<
      Record<string, unknown>,
      {
        remainder: Record<string, unknown>[];
        fragment: Record<string, unknown>[];
      }
    >();
    const fragments: Record<string, unknown>[] = [];
    for (const shape of region.shapes) {
      if (!lc.shapes.includes(shape)) continue;
      const bounds = getShapeBounds(shape);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;

      const rendered = this.renderSelectionShape(shape, bounds);
      if (!rendered) continue;

      const selectedCanvas = this.applySelectionPath(rendered, bounds, region, true);
      const remainderCanvas = this.applySelectionPath(rendered, bounds, region, false);
      const fragment = this.createImageShapes(selectedCanvas, bounds);
      const remainder = this.createImageShapes(remainderCanvas, bounds);
      replacements.set(shape, { remainder, fragment });
      fragments.push(...fragment);
    }

    if (!fragments.length) return [];

    const nextShapes: unknown[] = [];
    for (const shape of lc.shapes as Record<string, unknown>[]) {
      const split = selectedSet.has(shape) ? replacements.get(shape) : undefined;
      if (!split) {
        nextShapes.push(shape);
        continue;
      }
      nextShapes.push(...split.remainder, ...split.fragment);
    }

    lc.shapes.splice(0, lc.shapes.length, ...nextShapes);
    this.selectedShapes = fragments;
    this.selectedShape = fragments.at(-1) ?? null;
    setSelection(lc, fragments);
    lc.repaintLayer('main');
    this._drawSelectCanvas(lc);
    return fragments;
  }

  private applySelectionPath(
    source: HTMLCanvasElement,
    bounds: SelectionBounds,
    region: SelectionRegion,
    keepInside: boolean
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(bounds.width));
    canvas.height = Math.max(1, Math.ceil(bounds.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a canvas for the partial selection.');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    context.setTransform(canvas.width / bounds.width, 0, 0, canvas.height / bounds.height, 0, 0);
    context.globalCompositeOperation = keepInside ? 'destination-in' : 'destination-out';
    context.beginPath();
    const left = Math.min(region.start.x, region.end.x) - bounds.x;
    const top = Math.min(region.start.y, region.end.y) - bounds.y;
    const width = Math.abs(region.end.x - region.start.x);
    const height = Math.abs(region.end.y - region.start.y);
    if (region.mode === 'circle') {
      context.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else if ((region.mode === 'polygon' || region.mode === 'lasso') && region.path.length > 2) {
      context.moveTo(region.path[0].x - bounds.x, region.path[0].y - bounds.y);
      for (const point of region.path.slice(1)) {
        context.lineTo(point.x - bounds.x, point.y - bounds.y);
      }
      context.closePath();
    } else {
      context.rect(left, top, width, height);
    }
    context.fill();
    context.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }

  private createImageShapes(
    canvas: HTMLCanvasElement,
    bounds: SelectionBounds
  ): Record<string, unknown>[] {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not inspect a partial-selection image.');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const visited = new Uint8Array(canvas.width * canvas.height);
    const queue = new Int32Array(visited.length);
    const shapes: Record<string, unknown>[] = [];
    for (let seed = 0; seed < visited.length; seed += 1) {
      if (visited[seed] || !pixels[seed * 4 + 3]) continue;
      let head = 0;
      let tail = 1;
      queue[0] = seed;
      visited[seed] = 1;
      let left = canvas.width;
      let top = canvas.height;
      let right = -1;
      let bottom = -1;
      while (head < tail) {
        const index = queue[head++];
        const x = index % canvas.width;
        const y = Math.floor(index / canvas.width);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= canvas.width || ny >= canvas.height) continue;
            const next = ny * canvas.width + nx;
            if (visited[next] || !pixels[next * 4 + 3]) continue;
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      const image = document.createElement('canvas');
      image.width = right - left + 1;
      image.height = bottom - top + 1;
      const croppedContext = image.getContext('2d');
      if (!croppedContext) throw new Error('Could not crop a partial-selection image.');
      const component = croppedContext.createImageData(image.width, image.height);
      for (let i = 0; i < tail; i += 1) {
        const index = queue[i];
        const x = index % canvas.width;
        const y = Math.floor(index / canvas.width);
        const target = ((y - top) * image.width + x - left) * 4;
        component.data.set(pixels.subarray(index * 4, index * 4 + 4), target);
      }
      croppedContext.putImageData(component, 0, 0);
      Object.defineProperty(image, 'src', { value: image.toDataURL('image/png') });
      shapes.push(
        LC.createShape('Image', {
          x: bounds.x + (left * bounds.width) / canvas.width,
          y: bounds.y + (top * bounds.height) / canvas.height,
          image,
          cropWidth: image.width,
          cropHeight: image.height,
          scale: 1,
          scaleX: bounds.width / canvas.width,
          scaleY: bounds.height / canvas.height,
          rotation: 0,
        }) as Record<string, unknown>
      );
    }
    return shapes;
  }

  private _drawSelectCanvas(lc: LCInstance): void {
    if (!this.selectCtx) return;
    this.selectCanvas.width = lc.canvas.width;
    this.selectCanvas.height = lc.canvas.height;
    this.selectCtx.clearRect(0, 0, this.selectCanvas.width, this.selectCanvas.height);
    const shapes = lc.shapes.map((shape: unknown, index: number) => {
      const LCglobal = (window as unknown as Record<string, unknown>)['LC'] as Record<
        string,
        unknown
      >;
      const createShape = LCglobal['createShape'] as (
        n: string,
        a: Record<string, unknown>
      ) => unknown;
      if (shape && (shape as Record<string, unknown>)['className'] === 'Image') {
        return createShape('ImageSelectionOverlay', {
          shape: shape,
          overrideBg: '#' + this._intToHex(index + 1),
        });
      }
      const bounds = getShapeBounds(shape as Record<string, unknown>);
      return createShape('SelectionBox', {
        shape: bounds ? { getBoundingRect: () => bounds } : shape,
        handleSize: 0,
        backgroundColor: '#' + this._intToHex(index + 1),
      });
    });
    const activeLc = lc as unknown as Record<string, unknown>;
    if (typeof activeLc['draw'] === 'function') {
      (activeLc['draw'] as (s: unknown[], c: unknown) => void)(shapes, this.selectCtx);
    }
  }

  private _intToHex(i: number): string {
    return ('000000' + i.toString(16)).slice(-6);
  }

  private _getPixel(
    x: number,
    y: number,
    lc: LCInstance,
    ctx: CanvasRenderingContext2D
  ): number | null {
    const activeLc = lc as unknown as Record<string, unknown>;
    const p =
      typeof activeLc['drawingCoordsToClientCoords'] === 'function'
        ? (
            activeLc['drawingCoordsToClientCoords'] as (
              x: number,
              y: number
            ) => { x: number; y: number }
          )(x, y)
        : { x, y };

    if (p.x < 0 || p.x >= this.selectCanvas.width || p.y < 0 || p.y >= this.selectCanvas.height)
      return null;

    const pixel = ctx.getImageData(p.x, p.y, 1, 1).data;
    if (!pixel[3]) return null;
    const index = parseInt(this._rgbToHex(pixel[0], pixel[1], pixel[2]), 16) - 1;
    return index >= 0 ? index : null;
  }

  private _componentToHex(c: number): string {
    return ('0' + c.toString(16)).slice(-2);
  }
  private _rgbToHex(r: number, g: number, b: number): string {
    return `${this._componentToHex(r)}${this._componentToHex(g)}${this._componentToHex(b)}`;
  }
}

class MultiShapeTransformAction {
  constructor(
    private readonly lc: LCInstance,
    private readonly from: ReadonlyMap<Record<string, unknown>, { x: number; y: number }>,
    private readonly to: ReadonlyMap<Record<string, unknown>, { x: number; y: number }>
  ) {}

  do(): void {
    this.apply(this.to);
  }

  undo(): void {
    this.apply(this.from);
  }

  private apply(states: ReadonlyMap<Record<string, unknown>, { x: number; y: number }>): void {
    for (const [shape, position] of states) {
      if (typeof shape['setUpperLeft'] === 'function') {
        (shape['setUpperLeft'] as (point: { x: number; y: number }) => void).call(shape, position);
      } else {
        shape['x'] = position.x;
        shape['y'] = position.y;
      }
    }
    this.lc.repaintLayer('main');
  }
}

class PartialSelectionMoveAction {
  constructor(
    private readonly lc: LCInstance,
    private readonly before: readonly unknown[],
    private readonly after: readonly unknown[],
    private readonly beforeRegion: SelectionRegion | null,
    private readonly selectedFragments: readonly Record<string, unknown>[]
  ) {}

  do(): void {
    this.apply(this.after);
    setSelection(this.lc, [...this.selectedFragments]);
    setSelectionRegion(this.lc, null);
  }

  undo(): void {
    this.apply(this.before);
    setSelection(this.lc, this.beforeRegion?.shapes ?? []);
    setSelectionRegion(this.lc, this.beforeRegion);
  }

  private apply(shapes: readonly unknown[]): void {
    this.lc.shapes.splice(0, this.lc.shapes.length, ...shapes);
    this.lc.repaintLayer('main');
  }
}
