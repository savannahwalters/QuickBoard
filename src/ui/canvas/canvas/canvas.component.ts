import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  signal,
  computed,
  viewChild,
  inject,
  input,
  output,
  PLATFORM_ID,
  effect,
  DOCUMENT,
  HostListener,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppStore } from '../../../data/store/app.store';
import { ClearCanvasConfirmComponent } from '../clear-canvas-confirm';
import { PropertiesBarComponent } from '../properties-bar/properties-bar.component';
import { OnionSkinOverlayComponent } from '../onion-skin/onion-skin-overlay.component';
import { OnionSkinService } from '../onion-skin/onion-skin.service';
import { BoilOverlayComponent } from '../boil/boil-overlay.component';
import { BoilService } from '../boil/boil.service';
import { CanvasPersistenceService } from '../persistence/canvas-persistence.service';
import { ToolsBarComponent } from '../tools-bar/tools-bar.component';
import { CanvasUndoRedoService } from '../undo-redo/canvas-undo-redo.service';
import { Brush, ensureSquareBrushShapeRegistered } from '../../canvas/tools/brush';
import { ObjectEraser } from '../../canvas/tools/objecteraser';
import { BucketFill } from '../tools/bucketfill';
import { ImprovedSelectShape, registerImprovedSelectShapes } from '../tools/improved-select';
import { ZoomTool } from '../tools/zoom';
import { LCInstance, LCTool } from '../literally-canvas-interfaces';
import { CanvasViewportController } from './canvas-viewport-controller';
import { CanvasShortcutsController } from './canvas-shortcuts-controller';
import { UndoRedoService } from '../../../services/undo-redo.service';
import { CanvasDataService } from '../../../services/canvas-data.service';
import { appSettings } from 'src/settings-loader';

@Component({
  selector: 'app-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ClearCanvasConfirmComponent,
    PropertiesBarComponent,
    OnionSkinOverlayComponent,
    BoilOverlayComponent,
    ToolsBarComponent,
  ],
  templateUrl: './canvas.component.html',
  styleUrls: ['./canvas.component.css'],
})
export class CanvasComponent implements AfterViewInit, OnDestroy {
  readonly isCanvasFullscreen = input(false);
  readonly canvasFullscreenToggled = output<void>();

  readonly onionSkinLayers = inject(OnionSkinService).onionSkinLayers;
  private readonly boil = inject(BoilService);
  readonly currentBoilImage = this.boil.currentBoilImage;

  readonly canvasContainer = viewChild.required<ElementRef<HTMLElement>>('canvasContainer');
  readonly activeTool = signal<string>(appSettings.canvas.defaultTool ?? 'pencil');
  readonly viewport = new CanvasViewportController({
    activeTool: () => this.activeTool(),
    syncViewportRects: () => this.syncOnionLayerRect(),
    zoomKeepOnDefault: appSettings.canvas.zoomKeepOn ?? true,
    zoomClickStep: appSettings.canvas.zoomClickStep,
  });
  private readonly shortcutsController = new CanvasShortcutsController(this);
  readonly isZoomKeepOn = this.viewport.zoomKeepOn;
  readonly canvasZoomLevel = this.viewport.zoomLevel;
  private readonly toolSizeMap = signal<Record<string, number>>({
    pencil: appSettings.tools?.pencil?.size ?? 5,
    brush: appSettings.tools?.brush?.size ?? 5,
    rectangle: appSettings.tools?.rectangle?.size ?? 5,
    circle: appSettings.tools?.circle?.size ?? 5,
    polygon: appSettings.tools?.polygon?.size ?? 5,
    eraser: appSettings.tools?.eraser?.size ?? 5,
    'object-eraser': 1,
  });
  readonly strokeSize = computed(() => this.toolSizeMap()[this.activeTool()] ?? 5);
  readonly brushSpacing = signal<number>(appSettings.tools?.brush?.spacing ?? 45);
  readonly colorTolerance = signal<number>(appSettings.tools?.bucketFill?.tolerance ?? 16);
  readonly strokeColor = signal<string>(appSettings.canvas.defaultStrokeColor ?? '#000000');
  readonly fillColor = signal<string>(appSettings.canvas.defaultFillColor ?? '#ffffff');
  readonly backgroundColor = signal<string>(appSettings.canvas.defaultBackgroundColor ?? '#ffffff');
  readonly onionLayerRect = signal({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  readonly onionImageRect = signal({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });

  readonly colorPickers = [
    {
      label: 'Stroke',
      signal: this.strokeColor,
      setter: this.setStrokeColor.bind(this),
      quickColors: ['transparent', appSettings.canvas.defaultStrokeColor ?? '#000000'],
    },
    {
      label: 'Fill',
      signal: this.fillColor,
      setter: this.setFillColor.bind(this),
      quickColors: ['transparent', appSettings.canvas.defaultFillColor ?? '#ffffff'],
    },
    {
      label: 'BG',
      signal: this.backgroundColor,
      setter: this.setBackgroundColor.bind(this),
      quickColors: ['transparent', appSettings.canvas.defaultBackgroundColor ?? '#ffffff'],
    },
  ];

  readonly store = inject(AppStore);
  private readonly onionSkin = inject(OnionSkinService);
  private readonly canvasPersistence = inject(CanvasPersistenceService);
  private readonly canvasUndoRedo = inject(CanvasUndoRedoService);
  private readonly el = inject(ElementRef);
  private readonly undoRedo = inject(UndoRedoService);
  private readonly canvasDataService = inject(CanvasDataService);
  lc: LCInstance | null = null;
  private toolInstances = new Map<string, LCTool>();
  private platformId = inject(PLATFORM_ID);
  private currentBoardId: string | null = null;
  private initCanvasTimeout: number | null = null;
  private updateCanvasTimeout: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeRafId: number | null = null;
  private lastFitHeight = 0;
  private lastFitAvailableHostWidth = 0;
  private readonly onWindowResize = () => this.scheduleCanvasFit();
  private _canvasDirty = false;
  readonly showClearCanvasConfirm = signal(false);
  readonly toolbar = viewChild(ToolsBarComponent);
  document = inject(DOCUMENT);

  constructor() {
    effect(() => {
      const selectedBoardId = this.store.currentBoardId();

      if (!this.lc || !selectedBoardId) return;

      const boardIdChanged = selectedBoardId !== this.currentBoardId;
      const currentBoardData = this.canvasDataService.getCanvasData(selectedBoardId);
      const canvasDataChanged = this.canvasPersistence.hasCanvasDataChanged(currentBoardData);

      // Only reload when switching boards or when the canvas data reference changes
      if (boardIdChanged) {
        if (this.currentBoardId && this.lc && this._canvasDirty) {
          const snapshot = this.lc.getSnapshot();
          this.canvasDataService.setCanvasData(this.currentBoardId, {
            shapes: [...this.lc.shapes],
            backgroundShapes: [...this.lc.backgroundShapes],
            snapshot,
          });
        }

        // Ensure any deferred preview for the outgoing board is committed before switching.
        this.canvasPersistence.flushPendingPreviewRegeneration(this.lc, this.currentBoardId);
        // Save current board data before switching
        if (this.currentBoardId && this.lc) {
          this.canvasPersistence.persistCurrentBoardData(
            this.lc,
            this.currentBoardId,
            this.currentBoardId,
            true
          );
          this.store.updateBackgroundColor(this.currentBoardId, this.lc.getColor('background'));
          this._canvasDirty = false;
        }
        this.loadBoardData(selectedBoardId);
      } else if (canvasDataChanged) {
        this.loadBoardData(selectedBoardId);
      }
    });

    // Keep boil variations warm for the current board so playback wiggles immediately.
    effect(() => {
      const boards = this.store.boards();
      const currentId = this.store.currentBoardId();
      this.store.isPlaying();
      const board = boards.find((b) => b.id === currentId);
      if (board) {
        this.boil.ensureVariations(board);
      }
    });
  }

  ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId) && typeof LC !== 'undefined') {
      this.initCanvasTimeout = window.setTimeout(() => {
        this.initializeCanvas();
        // Ensure preview is generated for the first board if missing
        const boards = this.store.boards();
        const firstBoard = boards[0];
        if (firstBoard && !firstBoard.previewUrl) {
          // Generate preview for empty board
          if (this.lc) {
            // Render background color
            this.lc.setColor('background', firstBoard.backgroundColor ?? '#ffffff');
            this.lc.repaintLayer('main');

            const boardId = firstBoard.id;
            const snapshot = this.lc.getSnapshot();
            const shapes = [...this.lc.shapes];
            const backgroundShapes = [...this.lc.backgroundShapes];

            // Update CanvasDataService immediately
            this.canvasDataService.setCanvasData(boardId, {
              shapes,
              backgroundShapes,
              snapshot,
            });

            // Save preview as a Blob URL to keep base64 data off the V8 heap
            this.lc.getImage({ scale: 0.2 }).toBlob((blob) => {
              if (!this.lc || !blob) return;
              const newUrl = URL.createObjectURL(blob);
              const oldUrl = this.store.boards().find((b) => b.id === boardId)?.previewUrl;
              this.store.updateBoardPreview(boardId, newUrl);
              if (oldUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(oldUrl);
              }
            }, 'image/png');
          }
        }
      }, 0);
    }
  }

  ngOnDestroy() {
    if (this.initCanvasTimeout !== null) {
      clearTimeout(this.initCanvasTimeout);
      this.initCanvasTimeout = null;
    }

    // Clean up LiterallyCanvas instance and event listeners
    if (this.lc) {
      this.viewport.detach();
      this.lc.teardown();
      this.lc = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }

    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.onWindowResize);
    }

    // Clear tool instances to release references
    this.toolInstances.clear();

    this.canvasPersistence.clearPendingPreviewRegeneration();
  }

  switchTools(tool: string): void {
    this.activeTool.set(tool);
    this.toolbar()?.toolSelected.emit(tool);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    this.shortcutsController.handleKeyDown(event);
  }

  private initializeCanvas(): void {
    // Clear the init timeout reference as it has already fired
    this.initCanvasTimeout = null;

    const container = this.canvasContainer().nativeElement;

    // Get the current board or first board
    const boards = this.store.boards();
    const currentBoard = boards.find((b) => b.id === this.store.currentBoardId()) || boards[0];
    if (currentBoard) {
      this.currentBoardId = currentBoard.id;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerImprovedSelectShapes(LC as any);

    // Initialize Literally Canvas — container is already at the correct size
    this.lc = LC.init(container, {
      imageURLPrefix: 'assets/lc-images',
    });
    this.viewport.attach(this.lc);

    container.addEventListener(
      'mousedown',
      (event: MouseEvent) => {
        if (event.button !== 0) {
          return;
        }

        if (this.lc) {
          this.canvasUndoRedo.markStrokeStart(this.lc);
        }
      },
      { capture: true }
    );

    ensureSquareBrushShapeRegistered();

    this.lc.setImageSize(this.store.width(), this.store.height());

    const initialCanvasData = currentBoard
      ? this.canvasDataService.getCanvasData(currentBoard.id)
      : null;
    if (initialCanvasData) {
      this.lc.loadSnapshot(initialCanvasData);
    }
    const initialBackground = currentBoard?.backgroundColor ?? '#ffffff';
    this.lc.setColor('background', initialBackground);
    this.backgroundColor.set(initialBackground);
    this.setStrokeColor(this.strokeColor());
    this.setFillColor(this.fillColor());

    // Set up resize handling first; the ResizeObserver's initial callback
    // will drive the first fitCanvasToContainer() after layout has settled,
    // ensuring LC sees post-reflow container dimensions.
    this.observeCanvasResize();
    window.addEventListener('resize', this.onWindowResize);
    this.syncOnionLayerRect();

    this.lc.on('drawingChange', () => {
      if (this.lc) {
        this._canvasDirty = true;
        // Debounce the canvas data update to avoid excessive store updates
        if (this.updateCanvasTimeout !== null) {
          clearTimeout(this.updateCanvasTimeout);
        }
        this.updateCanvasTimeout = window.setTimeout(() => {
          if (this.lc && this.currentBoardId) {
            const boardId = this.currentBoardId;
            const snapshot = this.lc.getSnapshot();
            const shapes = [...this.lc.shapes];
            const backgroundShapes = [...this.lc.backgroundShapes];

            this.canvasPersistence.setLastLoadedCanvasData(snapshot);
            this._canvasDirty = false;

            // Update CanvasDataService immediately
            this.canvasDataService.setCanvasData(boardId, {
              shapes,
              backgroundShapes,
              snapshot,
            });

            this.lc.getImage({ scale: 0.2 }).toBlob((blob) => {
              if (!this.lc || this.currentBoardId !== boardId || !blob) return;

              const newUrl = URL.createObjectURL(blob);
              const oldUrl = this.store.boards().find((b) => b.id === boardId)?.previewUrl;

              this.store.updateBoardPreview(boardId, newUrl);
              if (oldUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(oldUrl);
              }
            }, 'image/png');
          }
          this.updateCanvasTimeout = null;
        }, 300);

        this.canvasUndoRedo.onDrawingChange(this.lc, this.currentBoardId, (id, include, options) =>
          this.canvasPersistence.persistCurrentBoardData(
            this.lc,
            id,
            this.currentBoardId,
            include,
            options
          )
        );
      }
    });

    // Initialize tool instances
    this.toolInstances.set('select', new ImprovedSelectShape(this.lc));
    this.toolInstances.set('pencil', new LC.tools.Pencil(this.lc));
    this.toolInstances.set('eraser', new LC.tools.Eraser(this.lc));
    this.toolInstances.set('brush', new Brush(this.lc));
    this.toolInstances.set('rectangle', new LC.tools.Rectangle(this.lc));
    this.toolInstances.set('circle', new LC.tools.Ellipse(this.lc));
    // Use the built-in LC polygon tool when available.
    const shapeTools = LC.tools as {
      Polygon?: new (lc: LCInstance) => LCTool;
      Triangle?: new (lc: LCInstance) => LCTool;
    };
    const PolygonTool = shapeTools.Polygon ?? shapeTools.Triangle;
    if (PolygonTool) {
      this.toolInstances.set('polygon', new PolygonTool(this.lc));
    }
    this.toolInstances.set('bucket-fill', new BucketFill(this.lc));
    this.toolInstances.set(
      'zoom',
      new ZoomTool(
        this.lc,
        (deltaLevel, point) => this.viewport.adjustZoomLevel(deltaLevel, point),
        this.viewport.getClickZoomStep()
      )
    );

    const objectEraser = this.canvasUndoRedo.instrumentObjectEraser(
      new ObjectEraser(this.lc),
      (id, include, options) =>
        this.canvasPersistence.persistCurrentBoardData(
          this.lc,
          id,
          this.currentBoardId,
          include,
          options
        )
    );
    this.toolInstances.set('object-eraser', objectEraser);

    const brushTool = this.toolInstances.get('brush') as Brush | undefined;
    if (brushTool) {
      brushTool.spacing = this.brushSpacing();
    }

    this.setColorTolerance(this.colorTolerance());

    // Apply the configured size to each drawing tool.
    this.toolInstances.forEach((tool, id) => {
      if (tool.strokeWidth !== undefined) {
        tool.strokeWidth = this.toolSizeMap()[id] ?? 5;
      }
    });

    // Activate the default tool
    const defaultTool = appSettings.canvas.defaultTool ?? 'pencil';
    this.setTool(this.toolInstances.has(defaultTool) ? defaultTool : 'pencil');
  }

  private loadBoardData(boardId: string) {
    if (!this.lc) return;

    ensureSquareBrushShapeRegistered();

    const boards = this.store.boards();
    const board = boards.find((b) => b.id === boardId);

    this.currentBoardId = boardId;
    this._canvasDirty = false;

    this.canvasUndoRedo.beginBoardLoad();

    const selectTool = this.toolInstances.get('select') as ImprovedSelectShape;
    if (selectTool && typeof selectTool.clearSelection === 'function') {
      selectTool.clearSelection(this.lc);
    }

    // Clear canvas
    this.lc.shapes = [];
    this.lc.backgroundShapes = [];

    // Load new board data
    const cache = board ? this.canvasDataService.getBoardCache(board.id) : null;
    if (board && cache) {
      if (cache.shapes && cache.backgroundShapes) {
        this.lc.shapes = [...cache.shapes];
        this.lc.backgroundShapes = [...cache.backgroundShapes];
        this.lc.repaintLayer('main');
        this.lc.repaintLayer('background');
      } else {
        this.lc.loadSnapshot(cache.snapshot);
        // Cache immediately so subsequent loads are instant
        this.canvasDataService.setCanvasData(board.id, {
          shapes: [...this.lc.shapes],
          backgroundShapes: [...this.lc.backgroundShapes],
          snapshot: cache.snapshot,
        });
      }
      this.canvasPersistence.setLastLoadedCanvasData(cache.snapshot);
    } else {
      this.lc.repaintLayer('main');
      this.canvasPersistence.setLastLoadedCanvasData(null);
    }
    this.lc.setImageSize(this.store.width(), this.store.height());
    const boardBackground = board?.backgroundColor ?? '#ffffff';
    this.lc.setColor('background', boardBackground);
    this.backgroundColor.set(boardBackground);
    this.scheduleCanvasFit();

    if (board && !board.previewUrl) {
      this.canvasPersistence.persistCurrentBoardData(this.lc, board.id, this.currentBoardId, true);
    }

    this.onionSkin.updateCurrentBoardPreview(this.lc, this.currentBoardId, boardId);
    this.onionSkin.pruneToCurrentAndNeighbors(boardId);

    this.canvasUndoRedo.finishBoardLoad(this.lc);
  }

  public flushCurrentBoardState(includePreviews = true): void {
    if (!this.lc || !this.currentBoardId) {
      return;
    }

    if (this.updateCanvasTimeout !== null) {
      clearTimeout(this.updateCanvasTimeout);
      this.updateCanvasTimeout = null;
    }

    this.canvasPersistence.persistCurrentBoardData(
      this.lc,
      this.currentBoardId,
      this.currentBoardId,
      includePreviews
    );
    this.store.updateBackgroundColor(this.currentBoardId, this.lc.getColor('background'));
    this._canvasDirty = false;
  }

  public prepareForProjectLoad(): void {
    if (this.updateCanvasTimeout !== null) {
      clearTimeout(this.updateCanvasTimeout);
      this.updateCanvasTimeout = null;
    }
    this.canvasPersistence.clearPendingPreviewRegeneration();
    this._canvasDirty = false;
  }

  private observeCanvasResize(): void {
    if (!this.lc || typeof ResizeObserver === 'undefined') return;

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    const host = this.el.nativeElement as HTMLElement;
    this.resizeObserver = new ResizeObserver(() => this.scheduleCanvasFit());
    this.resizeObserver.observe(host);
  }

  private scheduleCanvasFit(): void {
    if (!this.lc) return;

    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
    }

    this.resizeRafId = window.requestAnimationFrame(() => {
      this.resizeRafId = null;
      this.fitCanvasToContainer();
      this.syncOnionLayerRect();
    });
  }

  private fitCanvasToContainer(): void {
    if (!this.lc) return;

    const container = this.canvasContainer().nativeElement;
    const host = this.el.nativeElement as HTMLElement;
    const height = container.clientHeight;
    const availableHostWidth = this.getAvailableHostWidth(host);

    if (height <= 0 || availableHostWidth <= 0) return;
    if (
      Math.abs(height - this.lastFitHeight) < 0.5 &&
      Math.abs(availableHostWidth - this.lastFitAvailableHostWidth) < 0.5
    ) {
      return;
    }

    this.lastFitHeight = height;
    this.lastFitAvailableHostWidth = availableHostWidth;

    const toolsBar = host.querySelector<HTMLElement>('.tools-bar');

    const flexRow = host.querySelector<HTMLElement>('.canvas-container');
    const gap = flexRow ? this.getFlexGap(flexRow) : 0;

    const toolsBarWidth = toolsBar ? toolsBar.offsetWidth + gap : 0;
    const availableCanvasWidth = Math.max(1, availableHostWidth - toolsBarWidth);

    const heightScale = height / this.store.height();
    const widthScale = availableCanvasWidth / this.store.width();
    const scale = Math.min(heightScale, widthScale);
    if (!Number.isFinite(scale) || scale <= 0) return;

    const fittedCanvasWidth = Math.floor(this.store.width() * scale);
    host.style.width = Math.ceil(fittedCanvasWidth + toolsBarWidth) + 'px';

    if (this.lc.respondToSizeChange) {
      this.lc.respondToSizeChange();
    }

    this.viewport.applyFitScale(scale);
  }

  private getAvailableHostWidth(host: HTMLElement): number {
    const parent = host.parentElement as HTMLElement | null;
    if (!parent) {
      return host.clientWidth;
    }

    let availableWidth = parent.clientWidth;
    const scriptPane = parent.querySelector<HTMLElement>('app-script');
    if (!scriptPane) {
      return availableWidth;
    }

    const scriptStyles = window.getComputedStyle(scriptPane);
    if (scriptStyles.display === 'none') {
      return availableWidth;
    }

    const reservedScriptWidth = Number.parseFloat(scriptStyles.minWidth || '0') || 0;
    availableWidth -= reservedScriptWidth + this.getFlexGap(parent);
    return Math.max(0, availableWidth);
  }

  private getFlexGap(element: HTMLElement): number {
    const styles = window.getComputedStyle(element);
    const gapValue =
      styles.columnGap && styles.columnGap !== 'normal' ? styles.columnGap : styles.gap;
    return Number.parseFloat(gapValue || '0') || 0;
  }

  private syncOnionLayerRect(): void {
    if (!this.lc) return;

    const container = this.canvasContainer().nativeElement;
    const liveCanvas = this.lc.canvas;
    if (!container || !liveCanvas) return;

    const containerRect = container.getBoundingClientRect();
    const liveCanvasRect = liveCanvas.getBoundingClientRect();

    this.onionLayerRect.set({
      left: liveCanvasRect.left - containerRect.left,
      top: liveCanvasRect.top - containerRect.top,
      width: liveCanvasRect.width,
      height: liveCanvasRect.height,
    });

    const backingScale = this.lc.backingScale || 1;
    const renderScale = this.lc.getRenderScale?.() || this.lc.scale * backingScale || backingScale;
    const imageLeft = this.lc.position.x / backingScale;
    const imageTop = this.lc.position.y / backingScale;
    const imageWidth = (this.store.width() * renderScale) / backingScale;
    const imageHeight = (this.store.height() * renderScale) / backingScale;

    this.onionImageRect.set({
      left: imageLeft,
      top: imageTop,
      width: imageWidth,
      height: imageHeight,
    });
  }

  public setTool(toolId: string): void {
    if (!this.lc || !this.toolInstances.has(toolId)) return;

    const tool = this.toolInstances.get(toolId);
    if (tool) {
      if (tool.strokeWidth !== undefined) {
        tool.strokeWidth = this.toolSizeMap()[toolId] ?? 5;
      }
      if (toolId === 'brush') {
        (tool as Brush).spacing = this.brushSpacing();
      }
      this.lc.setTool(tool);
      this.activeTool.set(toolId);
    }
  }

  public setCanvasZoomLevel(level: number): void {
    this.viewport.setZoomLevel(level);
  }

  public setCanvasZoomLevelFromSlider(position: number): void {
    this.viewport.setZoomLevelFromSlider(position);
  }

  public setZoomKeepOn(keepOn: boolean): void {
    this.viewport.setZoomKeepOn(keepOn);
    appSettings.canvas.zoomKeepOn = this.viewport.zoomKeepOn();
  }

  public setBrushSpacing(spacing: number): void {
    if (isNaN(spacing)) return;
    const clamped = Math.max(10, Math.min(200, Math.round(spacing)));
    this.brushSpacing.set(clamped);

    const brushTool = this.toolInstances.get('brush') as Brush | undefined;
    if (brushTool) {
      brushTool.spacing = clamped;
    }
  }

  public setStrokeSize(size: number): void {
    if (isNaN(size) || size < 1) return;
    const value = Math.max(1, Math.round(size));
    this.toolSizeMap.update((m) => ({ ...m, [this.activeTool()]: value }));
    if (this.lc?.tool) {
      this.lc.tool.strokeWidth = value;
    }
  }

  public setStrokeSizeFromSlider(pos: number): void {
    // Exponential mapping: slider 0–100 → value 1–500
    const value = Math.round(Math.pow(500, pos / 100));
    this.setStrokeSize(Math.max(1, value));
  }

  public setColorTolerance(tol: number): void {
    if (isNaN(tol)) return;
    const clamped = Math.max(0, Math.min(128, Math.round(tol)));
    this.colorTolerance.set(clamped);
    const bucketTool = this.toolInstances.get('bucket-fill') as BucketFill | undefined;
    if (bucketTool) {
      bucketTool.tolerance = clamped;
    }
  }

  public requestClearCanvas(): void {
    const showWarning = appSettings.canvas.showClearCanvasWarning;
    if (showWarning) {
      this.showClearCanvasConfirm.set(true);
    } else {
      this.confirmClearCanvas();
    }
  }

  public toggleCanvasFullscreen(): void {
    this.canvasFullscreenToggled.emit();
  }

  public cancelClearCanvas(): void {
    this.showClearCanvasConfirm.set(false);
  }

  public confirmClearCanvas(): void {
    if (!this.lc) return;

    const lcRef = this.lc;
    const boardIdAtClear = this.currentBoardId;
    const before = this.canvasUndoRedo.prepareClear(lcRef);
    const after = lcRef.getSnapshot();

    if (boardIdAtClear) {
      this.canvasPersistence.persistCurrentBoardData(
        this.lc,
        boardIdAtClear,
        this.currentBoardId,
        true
      );
    }

    this.canvasUndoRedo.recordClear(lcRef, before, after, boardIdAtClear);

    this.showClearCanvasConfirm.set(false);
  }

  public setStrokeColor(color: string): void {
    if (!this.lc) return;

    // Handle transparent color
    const colorValue = color === 'transparent' ? 'hsla(0, 0%, 0%, 0)' : color;
    this.strokeColor.set(color);
    this.lc.setColor('primary', colorValue);
  }

  public setFillColor(color: string): void {
    if (!this.lc) return;

    // Handle transparent color
    const colorValue = color === 'transparent' ? 'hsla(0, 0%, 100%, 0)' : color;
    this.fillColor.set(color);
    this.lc.setColor('secondary', colorValue);
  }

  public setBackgroundColor(color: string): void {
    if (!this.lc) return;
    const oldColor = this.backgroundColor();
    this.backgroundColor.set(color);
    this.lc.setColor('background', color);
    if (this.currentBoardId) {
      this.store.updateBackgroundColor(this.currentBoardId, color);
      // Record only if actually changed
      if (oldColor !== color) {
        const boardId = this.currentBoardId;
        this.undoRedo.record({
          undo: () => {
            this.store.updateBackgroundColor(boardId, oldColor);
            if (this.currentBoardId !== boardId) {
              this.store.setCurrentBoard(boardId);
            } else {
              this.backgroundColor.set(oldColor);
              this.lc?.setColor('background', oldColor);
            }
          },
          redo: () => {
            this.store.updateBackgroundColor(boardId, color);
            if (this.currentBoardId !== boardId) {
              this.store.setCurrentBoard(boardId);
            } else {
              this.backgroundColor.set(color);
              this.lc?.setColor('background', color);
            }
          },
        });
      }
    }
  }

  public undoStroke(): void {
    if (!this.lc) {
      return;
    }

    this.canvasUndoRedo.undoStroke(this.lc);

    if (this.currentBoardId) {
      this.canvasPersistence.persistCurrentBoardData(
        this.lc,
        this.currentBoardId,
        this.currentBoardId,
        true
      );
    }
  }

  public redoStroke(): void {
    if (!this.lc) {
      return;
    }

    this.canvasUndoRedo.redoStroke(this.lc);

    if (this.currentBoardId) {
      this.canvasPersistence.persistCurrentBoardData(
        this.lc,
        this.currentBoardId,
        this.currentBoardId,
        true
      );
    }
  }

  public onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  public onDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        this.handleImageFile(file);
      }
    }
  }

  public handleImageFile(file: File): void {
    if (!this.lc) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        if (!this.lc) return;

        const defaultWidth = img.width;
        const defaultHeight = img.height;
        const backingScale = this.lc.backingScale || 1;

        // Find center of canvas
        const centerX =
          this.lc.canvas.width / 2 / (this.lc.scale * backingScale) -
          this.lc.position.x / backingScale -
          defaultWidth / 2;
        const centerY =
          this.lc.canvas.height / 2 / (this.lc.scale * backingScale) -
          this.lc.position.y / backingScale -
          defaultHeight / 2;

        // LC.createShape requires image: Image object
        const imageShape = LC.createShape('Image', {
          x: centerX,
          y: centerY,
          image: img,
          scale: 1,
        });

        this.lc.saveShape(imageShape);
        this.setTool('select');
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }
}
