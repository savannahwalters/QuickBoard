import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../../data/store/app.store';
import { CanvasDataService } from '../../../services/canvas-data.service';
import { BoilService } from './boil.service';

const nativeStructuredClone = globalThis.structuredClone;

describe.each(['structuredClone', 'JSON fallback'])('boil snapshot cloning with %s', (mode) => {
  let service: BoilService;
  let store: InstanceType<typeof AppStore>;
  let canvasData: CanvasDataService;
  const loadSnapshot = vi.fn();
  const teardown = vi.fn();

  beforeEach(() => {
    vi.stubGlobal(
      'structuredClone',
      mode === 'JSON fallback'
        ? undefined
        : vi.fn((value) => {
            for (const collection of ['shapes', 'backgroundShapes']) {
              for (const shape of value[collection] ?? []) {
                if (shape.data?.imageObject instanceof Element) {
                  throw new DOMException('DOM elements cannot be cloned', 'DataCloneError');
                }
              }
            }
            return nativeStructuredClone(value);
          })
    );
    vi.stubGlobal('LC', {
      JSONToShape: vi.fn((shape) => shape),
      init: () => ({
        setImageSize: vi.fn(),
        loadSnapshot,
        setColor: vi.fn(),
        getImage: () => ({ toDataURL: () => 'data:image/png;base64,variation' }),
        teardown,
      }),
    });
    TestBed.configureTestingModule({});
    service = TestBed.inject(BoilService);
    store = TestBed.inject(AppStore);
    canvasData = TestBed.inject(CanvasDataService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(['fill canvas', 'imported image', 'reopened image'])(
    'preserves %s references in variations and export segments without mutating source data',
    (source) => {
      const image = document.createElement(source === 'fill canvas' ? 'canvas' : 'img');
      const backgroundImage = document.createElement('img');
      const board = {
        ...store.boards()[0],
        boilEnabled: true,
        duration: 1,
        boilParams: { variations: 3, holdFrames: 2, amount: 2.5 },
      };
      const snapshot = {
        shapes: [
          {
            className: 'Image',
            data: { x: 10, y: 20, imageSrc: 'blob:foreground', imageObject: image, scale: 2 },
          },
          {
            className: 'LinePath',
            data: {
              pointCoordinatePairs: [
                [5, 6],
                [7, 8],
              ],
            },
          },
        ],
        backgroundShapes: [
          {
            className: 'Image',
            data: { x: 0, y: 0, imageSrc: 'blob:background', imageObject: backgroundImage },
          },
        ],
      };
      if (source === 'reopened image') {
        store.loadFromJson(
          JSON.stringify({ boards: [{ ...board, canvasData: snapshot }] }),
          new Map([
            ['blob:foreground', image as HTMLImageElement],
            ['blob:background', backgroundImage],
          ])
        );
      } else {
        canvasData.setCanvasData(board.id, snapshot);
      }
      const original = canvasData.getCanvasData(board.id)!;
      const originalJson = JSON.stringify(original);
      const assertCopy = (copy: Record<string, unknown>) => {
        const shapes = copy['shapes'] as typeof snapshot.shapes;
        const backgrounds = copy['backgroundShapes'] as typeof snapshot.backgroundShapes;
        expect(copy).not.toBe(original);
        expect(shapes[0].data.imageObject).toBe(image);
        expect(backgrounds[0].data.imageObject).toBe(backgroundImage);
        expect(shapes[0].data).not.toBe(snapshot.shapes[0].data);
        expect(shapes[1].data.pointCoordinatePairs).not.toBe(
          snapshot.shapes[1].data.pointCoordinatePairs
        );
        expect(shapes[0].data.x).not.toBe(10);
        expect(backgrounds[0].data.x).toBe(0);
      };

      expect(() => service.ensureVariations(board)).not.toThrow();
      expect(loadSnapshot).toHaveBeenCalledTimes(3);
      for (const [variation] of loadSnapshot.mock.calls) assertCopy(variation);
      expect(teardown).toHaveBeenCalledTimes(3);

      const segments = service.expandBoardToSegments(board, original, 24);
      expect(segments.length).toBeGreaterThan(1);
      expect(segments.reduce((total, segment) => total + segment.durationSeconds, 0)).toBeCloseTo(
        1
      );
      for (const segment of segments) assertCopy(segment.snapshot!);
      expect(JSON.stringify(original)).toBe(originalJson);
      expect(snapshot.shapes[0].data.imageObject).toBe(image);
      expect(snapshot.backgroundShapes[0].data.imageObject).toBe(backgroundImage);
    }
  );
});
