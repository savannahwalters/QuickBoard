import { Injectable, inject } from '@angular/core';
import JSZip from 'jszip';
import { AppStore } from '../data/store/app.store';
import { AudioService } from '../services/audio.service';

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
};

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

@Injectable({ providedIn: 'root' })
export class SbdService {
  private readonly store = inject(AppStore);
  private readonly audio = inject(AudioService);

  async buildSbdZip(): Promise<Uint8Array> {
    const zip = new JSZip();
    const audioBuffers = this.audio.getFileBuffers();

    // Replace live blob URLs with stable zip-relative paths before serialising.
    const rawJson = JSON.parse(this.store.exportAsJson());
    if (Array.isArray(rawJson.audioTracks)) {
      rawJson.audioTracks = rawJson.audioTracks.map(
        (track: { id: string; name: string; url: string }) => {
          const ext = track.name.includes('.') ? track.name.split('.').pop() : 'audio';
          return { ...track, url: `audio/${track.id}.${ext}` };
        }
      );
    }
    if (Array.isArray(rawJson.boards)) {
      rawJson.boards = await Promise.all(
        rawJson.boards.map(
          async (board: {
            id: string;
            previewUrl?: string;
            canvasData?: Record<string, unknown>;
          }) => {
            let previewExtUrl: string | null = null;
            if (board.previewUrl?.startsWith('blob:')) {
              try {
                const res = await fetch(board.previewUrl);
                const blob = await res.blob();
                const arrayBuffer = await blob.arrayBuffer();
                const path = `previews/${board.id}.png`;
                zip.file(path, arrayBuffer);
                previewExtUrl = path;
              } catch (e) {
                console.error('Failed to save preview', e);
              }
            } else {
              previewExtUrl = board.previewUrl ?? null;
            }

            if (board.canvasData && Array.isArray(board.canvasData['shapes'])) {
              board.canvasData['shapes'] = await Promise.all(
                board.canvasData['shapes'].map(async (shape: Record<string, unknown>) => {
                  if (shape['className'] === 'Image' && shape['data']) {
                    const data = shape['data'] as Record<string, unknown>;
                    if (typeof data['imageSrc'] === 'string') {
                      const src = data['imageSrc'];
                      if (src.startsWith('data:image/') || src.startsWith('blob:')) {
                        try {
                          const res = await fetch(src);
                          const blob = await res.blob();
                          const arrayBuf = await blob.arrayBuffer();
                          const imageId = crypto.randomUUID();
                          const ext = IMAGE_EXT_BY_MIME[blob.type] ?? 'png';
                          const path = `assets/images/${imageId}.${ext}`;
                          zip.file(path, arrayBuf);
                          data['imageSrc'] = path;
                        } catch (e) {
                          console.error('Failed to save image shape to zip', e);
                        }
                      }
                    }
                  }
                  return shape;
                })
              );
            }

            if (board.canvasData && board.canvasData['imageSize']) {
              delete board.canvasData['imageSize'];
            }

            return {
              ...board,
              previewUrl: previewExtUrl,
            };
          }
        )
      );
    }
    zip.file('project.json', JSON.stringify(rawJson, null, 2));

    for (const [id, { buffer, fileName }] of audioBuffers) {
      const ext = fileName.includes('.') ? fileName.split('.').pop() : 'audio';
      zip.file(`audio/${id}.${ext}`, buffer);
    }

    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  /** Restores state from a plain-JSON project file (legacy format). */
  loadLegacyJson(json: string): void {
    this.store.loadFromJson(json);
  }

  async loadSbdZip(content: string | Uint8Array): Promise<void> {
    let bytes: Uint8Array;

    if (content instanceof Uint8Array) {
      bytes = content;
    } else {
      // Decode base64 → binary.
      const binaryStr = atob(content);
      bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
    }

    const zip = await JSZip.loadAsync(bytes);

    const projectFile = zip.file('project.json');
    if (!projectFile) throw new Error('Invalid .sbd file: missing project.json');
    const projectJson = await projectFile.async('string');
    const projectData = JSON.parse(projectJson);
    const imageObjects = new Map<string, HTMLImageElement>();

    // Extract previews and convert to Blob URLs
    if (Array.isArray(projectData.boards)) {
      await Promise.all(
        projectData.boards.map(
          async (board: {
            id: string;
            previewUrl?: string;
            canvasData?: Record<string, unknown>;
          }) => {
            if (board.previewUrl && board.previewUrl.startsWith('previews/')) {
              const previewFile = zip.file(board.previewUrl);
              if (previewFile) {
                const arrayBuffer = await previewFile.async('arraybuffer');
                const blob = new Blob([arrayBuffer], { type: 'image/png' });
                board.previewUrl = URL.createObjectURL(blob);
              } else {
                board.previewUrl = undefined;
              }
            }

            if (board.canvasData && Array.isArray(board.canvasData['shapes'])) {
              board.canvasData['shapes'] = await Promise.all(
                board.canvasData['shapes'].map(async (shape: Record<string, unknown>) => {
                  if (shape['className'] === 'Image' && shape['data']) {
                    const data = shape['data'] as Record<string, unknown>;
                    if (typeof data['imageSrc'] === 'string') {
                      const src = data['imageSrc'];
                      if (src.startsWith('assets/images/')) {
                        const imgFile = zip.file(src);
                        if (!imgFile) {
                          throw new Error(`Invalid .sbd file: missing image asset ${src}`);
                        }
                        const arrayBuffer = await imgFile.async('arraybuffer');
                        const ext = src.split('.').pop()?.toLowerCase() ?? 'png';
                        const mimeType = IMAGE_MIME_BY_EXT[ext] ?? 'image/png';
                        const blob = new Blob([arrayBuffer], { type: mimeType });
                        data['imageSrc'] = URL.createObjectURL(blob);
                      }
                      const imageSrc = data['imageSrc'] as string;
                      if (imageSrc.startsWith('blob:') || imageSrc.startsWith('data:image/')) {
                        const image = new Image();
                        image.src = imageSrc;
                        await image.decode();
                        imageObjects.set(imageSrc, image);
                      }
                    }
                  }
                  return shape;
                })
              );
            }

            if (board.canvasData && board.canvasData['imageSize']) {
              delete board.canvasData['imageSize'];
            }
          }
        )
      );
    }

    // Extract each audio file into a Blob keyed by track id.
    const audioTracks: { id: string; url: string }[] = Array.isArray(projectData.audioTracks)
      ? projectData.audioTracks
      : [];

    const blobMap = new Map<string, Blob>();
    await Promise.all(
      audioTracks.map(async (track) => {
        const zipEntry = zip.file(track.url); // url is "audio/<id>.<ext>"
        if (!zipEntry) return;
        const arrayBuffer = await zipEntry.async('arraybuffer');
        const ext = track.url.split('.').pop() ?? 'audio';
        const mime = MIME_TYPES[ext] ?? 'audio/mpeg';
        blobMap.set(track.id, new Blob([arrayBuffer], { type: mime }));
      })
    );

    // Restore store state then reload Tone.js players from the extracted blobs.
    this.store.loadFromJson(JSON.stringify(projectData), imageObjects);
    await this.audio.loadFromSavedTracks(this.store.audioTracks(), blobMap);
  }
}
