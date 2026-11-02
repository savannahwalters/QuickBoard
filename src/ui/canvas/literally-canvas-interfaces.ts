export interface LCTool {
  name?: string;
  iconName?: string;
  strokeWidth?: number;
  optionsStyle?: string;
  willBecomeActive?(lc: LCInstance): void;
  didBecomeActive?(lc: LCInstance): void;
  begin?(x: number, y: number, lc: LCInstance): void;
  ['continue']?(x: number, y: number, lc: LCInstance): void;
  end?(x: number, y: number, lc: LCInstance): void;
  willBecomeInactive?(lc: LCInstance): void;
  didBecomeInactive?(lc: LCInstance): void;
}

export interface LCInstance {
  canvas: HTMLCanvasElement;
  backgroundCanvas: HTMLCanvasElement;
  containerEl: HTMLElement;
  backingScale: number;
  scale: number;
  position: { x: number; y: number };
  getRenderScale(): number;
  clientCoordsToDrawingCoords?(x: number, y: number): { x: number; y: number };
  drawingCoordsToClientCoords?(x: number, y: number): { x: number; y: number };
  undo(): void;
  redo(): void;
  undoStack: unknown[];
  redoStack: unknown[];
  setTool(tool: LCTool): void;
  backgroundShapes: unknown[];
  shapes: unknown[];
  repaintLayer(layer: string): void;
  trigger(event: string, data?: unknown): void;
  isDragging?: boolean;
  tool: LCTool;
  getColor(type: string): string;
  setColor(type: string, color: string): void;
  setImageSize(width: number, height: number): void;
  setZoom(scale: number): void;
  setPan?(x: number, y: number): void;
  pan?(x: number, y: number): void;
  zoom?(amount: number): void;
  respondToSizeChange?: () => void;
  setShapesInProgress(shapes: unknown[]): void;
  saveShape(shape: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  getSnapshot(): Record<string, unknown>;
  getImage(opts?: {
    scale?: number;
    includeWatermark?: boolean;
    scaleDownRetina?: boolean;
    rect?: { x: number; y: number; width: number; height: number };
  }): HTMLCanvasElement;
  loadSnapshot(snapshot: Record<string, unknown>): void;
  teardown(): void;
}

export type LiterallyCanvasTool = new (lc: LCInstance) => LCTool;

export interface LiterallyCanvas {
  init(
    element: HTMLElement,
    options?: {
      imageURLPrefix?: string;
      imageSize?: { width: number; height: number };
    }
  ): LCInstance;
  tools: {
    Pencil: LiterallyCanvasTool;
    Eraser: LiterallyCanvasTool;
    Rectangle: LiterallyCanvasTool;
    Ellipse: LiterallyCanvasTool;
    SelectShape: LiterallyCanvasTool;
    Polygon?: LiterallyCanvasTool;
    Triangle?: LiterallyCanvasTool;
  };
  createShape(type: string, args: Record<string, unknown>): unknown;
  JSONToShape(shape: Record<string, unknown>): unknown;
  snapshotJSONToShapes(snapshot: string): unknown[];
  shapeToJSON(shape: unknown): Record<string, unknown>;
}

declare global {
  const LC: LiterallyCanvas;
}
