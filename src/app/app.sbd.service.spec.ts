import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { AppStore } from '../data/store/app.store';
import { AudioService } from '../services/audio.service';
import { CanvasDataService } from '../services/canvas-data.service';
import { SbdService } from './app.sbd.service';

describe('project fill persistence', () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const decode = vi.fn<() => Promise<void>>();
  let blobs: Map<string, Blob>;
  let store: InstanceType<typeof AppStore>;
  let canvasData: CanvasDataService;
  let service: SbdService;

  beforeEach(() => {
    blobs = new Map();
    decode.mockResolvedValue(undefined);
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        width = 0;
        height = 0;
        async decode() {
          await decode();
          this.width = 4;
          this.height = 3;
        }
      }
    );
    vi.stubGlobal('LC', {
      JSONToShape: vi.fn((shape) => ({
        ...shape.data,
        image: shape.data.imageObject,
        className: shape.className,
      })),
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      const url = `blob:test-${blobs.size}`;
      blobs.set(url, blob as Blob);
      return url;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (src: string) => ({
        blob: async () => {
          const blob = blobs.get(src) ?? new Blob([png], { type: 'image/png' });
          return {
            type: blob.type,
            arrayBuffer: () =>
              new Promise<ArrayBuffer>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as ArrayBuffer);
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(blob);
              }),
          };
        },
      }))
    );
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AudioService,
          useValue: {
            getFileBuffers: () => new Map(),
            loadFromSavedTracks: vi.fn(),
          },
        },
      ],
    });
    store = TestBed.inject(AppStore);
    canvasData = TestBed.inject(CanvasDataService);
    service = TestBed.inject(SbdService);
    canvasData.setCanvasData(store.boards()[0].id, {
      shapes: [
        {
          className: 'Image',
          id: 'fill',
          data: {
            x: 0,
            y: 0,
            scale: 2,
            imageSrc: 'data:image/png;base64,iVBORw==',
            imageObject: {},
          },
        },
      ],
      backgroundShapes: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('retains the fill asset, placement and scale through save, reopen and resave', async () => {
    const firstSave = await service.buildSbdZip();
    const firstZip = await JSZip.loadAsync(firstSave);
    const firstProject = JSON.parse(await firstZip.file('project.json')!.async('string'));
    const savedShape = firstProject.boards[0].canvasData.shapes[0];
    expect(savedShape.data).toMatchObject({ x: 0, y: 0, scale: 2 });
    expect(savedShape.data.imageSrc).toMatch(/^assets\/images\/.+\.png$/);
    expect(await firstZip.file(savedShape.data.imageSrc)!.async('uint8array')).toEqual(png);

    await service.loadSbdZip(firstSave);
    const cache = canvasData.getBoardCache(store.boards()[0].id)!;
    expect(cache.shapes).toEqual([
      expect.objectContaining({
        className: 'Image',
        scale: 2,
        image: expect.objectContaining({ width: 4, height: 3 }),
      }),
    ]);
    expect(cache.snapshot['shapes']).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          imageObject: expect.objectContaining({ width: 4, height: 3 }),
        }),
      }),
    ]);

    const secondZip = await JSZip.loadAsync(await service.buildSbdZip());
    const secondProject = JSON.parse(await secondZip.file('project.json')!.async('string'));
    const resavedShape = secondProject.boards[0].canvasData.shapes[0];
    expect(resavedShape.data).toMatchObject({ x: 0, y: 0, scale: 2 });
    expect(await secondZip.file(resavedShape.data.imageSrc)!.async('uint8array')).toEqual(png);
  });

  it('waits for fill decoding before replacing project state', async () => {
    const zip = await service.buildSbdZip();
    let finishDecode!: () => void;
    decode.mockReturnValue(
      new Promise<void>((resolve) => {
        finishDecode = resolve;
      })
    );
    const loadFromJson = vi.spyOn(store, 'loadFromJson');
    const loading = service.loadSbdZip(zip);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    expect(loadFromJson).not.toHaveBeenCalled();
    finishDecode();
    await loading;
    expect(loadFromJson).toHaveBeenCalledOnce();
  });

  it('does not replace the current project when a fill cannot be decoded', async () => {
    const zip = await service.buildSbdZip();
    const loadFromJson = vi.spyOn(store, 'loadFromJson');
    decode.mockRejectedValue(new Error('Invalid PNG'));

    await expect(service.loadSbdZip(zip)).rejects.toThrow('Invalid PNG');
    expect(loadFromJson).not.toHaveBeenCalled();
  });

  it('rejects missing fill assets instead of silently losing the fill', async () => {
    const zip = await JSZip.loadAsync(await service.buildSbdZip());
    const project = JSON.parse(await zip.file('project.json')!.async('string'));
    zip.remove(project.boards[0].canvasData.shapes[0].data.imageSrc);
    const loadFromJson = vi.spyOn(store, 'loadFromJson');

    await expect(
      service.loadSbdZip(await zip.generateAsync({ type: 'uint8array' }))
    ).rejects.toThrow('missing image asset');
    expect(loadFromJson).not.toHaveBeenCalled();
  });
});
