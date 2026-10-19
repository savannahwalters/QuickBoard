import { inject } from '@angular/core';
import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';
import { computed } from '@angular/core';
import type { OutputData } from '@editorjs/editorjs';
import { CanvasDataService } from '../../services/canvas-data.service';
import { appSettings } from 'src/settings-loader';
import { sanitizeFps, sanitizeResolution, extractProjectDimensions } from './app-state-validation';
import type { PersistedProjectData } from './persisted-data.types';

export interface Board {
  id: string;
  scriptData: OutputData | null;
  previewUrl: string | null;
  backgroundColor: string;
  duration: number;
  boilEnabled?: boolean;
  boilParams?: { variations?: number; holdFrames?: number; amount?: number };
}

export interface AudioTrack {
  id: string;
  name: string;
  url: string;
  startTime: number;
  duration: number;
  trimStart: number;
  fileDuration: number;
  laneIndex: number;
  volume: number;
}

export interface AudioLaneMixer {
  volume: number; // 0–1 linear gain
  muted: boolean;
}

interface AppState {
  boards: Board[];
  currentBoardId: string | null;
  onionSkinEnabled: boolean;
  onionFramesBack: number;
  onionFramesForward: number;
  onionPrevColor: string;
  onionNextColor: string;
  audioTracks: AudioTrack[];
  audioLaneCount: number;
  audioLaneMixers: AudioLaneMixer[];
  isPlaying: boolean;
  currentTime: number; // seconds
  fps: number;
  width: number;
  height: number;
}

function createInitialState(): AppState {
  const firstBoardId = crypto.randomUUID();
  return {
    boards: [
      {
        id: firstBoardId,
        scriptData: null,
        previewUrl: null,
        backgroundColor: appSettings.canvas.defaultBackgroundColor,
        duration: appSettings.board.defaultDuration,
      },
    ],
    currentBoardId: firstBoardId,
    onionSkinEnabled: false,
    onionFramesBack: appSettings.onionSkin?.framesBack ?? 1,
    onionFramesForward: appSettings.onionSkin?.framesForward ?? 1,
    onionPrevColor: appSettings.onionSkin?.prevColor ?? '#ff00ff',
    onionNextColor: appSettings.onionSkin?.nextColor ?? '#00b3ff',
    audioTracks: [],
    audioLaneCount: appSettings.audio.defaultLaneCount,
    audioLaneMixers: [{ volume: appSettings.audio.defaultVolume, muted: false }],
    isPlaying: false,
    currentTime: 0,
    fps: appSettings.board.defaultFps,
    width: appSettings.board.width,
    height: appSettings.board.height,
  };
}

export const AppStore = signalStore(
  { providedIn: 'root' },
  withState(createInitialState),
  withMethods((store) => {
    const canvasDataService = inject(CanvasDataService);
    return {
      setCurrentBoard(boardId: string) {
        patchState(store, { currentBoardId: boardId });
      },

      addBoard() {
        const currentBoard = store.boards().find((board) => board.id === store.currentBoardId());
        const backgroundColor =
          currentBoard?.backgroundColor ?? appSettings.canvas.defaultBackgroundColor;
        const duration = currentBoard?.duration ?? appSettings.board.defaultDuration;
        const newBoard: Board = {
          id: crypto.randomUUID(),
          scriptData: null,
          previewUrl: null,
          backgroundColor,
          duration,
          boilEnabled: appSettings.boil?.boilNewFrames ?? false,
        };
        patchState(store, { boards: [...store.boards(), newBoard] });
        return newBoard.id;
      },

      deleteBoard(boardId: string) {
        // Revoke the blob URL to prevent memory leaks
        const boardToDelete = store.boards().find((b) => b.id === boardId);
        if (boardToDelete?.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(boardToDelete.previewUrl);
        }

        canvasDataService.deleteCanvasData(boardId);
        const boards = store.boards().filter((b) => b.id !== boardId);
        patchState(store, { boards });
      },

      updateBoardPreview(boardId: string, previewUrl: string) {
        const boards = store
          .boards()
          .map((board) => (board.id === boardId ? { ...board, previewUrl } : board));
        patchState(store, { boards });
      },

      updateBackgroundColor(boardId: string, backgroundColor: string) {
        const boards = store
          .boards()
          .map((board) => (board.id === boardId ? { ...board, backgroundColor } : board));
        patchState(store, { boards });
      },

      updateScriptData(boardId: string, scriptData: OutputData) {
        // Use structuredClone for better performance (native API is ~10x faster than JSON)
        const clonedData =
          typeof structuredClone === 'function'
            ? (structuredClone(scriptData) as OutputData)
            : (JSON.parse(JSON.stringify(scriptData)) as OutputData);
        const boards = store
          .boards()
          .map((board) => (board.id === boardId ? { ...board, scriptData: clonedData } : board));
        patchState(store, { boards });
      },

      exportAsJson(): string {
        return JSON.stringify(
          {
            boards: store.boards().map((b) => ({
              ...b,
              canvasData: canvasDataService.getCanvasData(b.id),
            })),
            currentBoardId: store.currentBoardId(),
            onionSkinEnabled: store.onionSkinEnabled(),
            audioTracks: store.audioTracks(),
            audioLaneCount: store.audioLaneCount(),
            audioLaneMixers: store.audioLaneMixers(),
            fps: store.fps(),
            width: store.width(),
            height: store.height(),
          },
          null,
          2
        );
      },

      loadFromJson(jsonString: string) {
        try {
          const data = JSON.parse(jsonString) as PersistedProjectData;
          if (!data || !Array.isArray(data.boards)) {
            throw new Error('Invalid JSON structure: "boards" array is required');
          }

          canvasDataService.clear();
          const cleanedBoards = data.boards.map((b) => {
            if (b.canvasData) {
              let shapes: unknown[] = [];
              let backgroundShapes: unknown[] = [];

              // Handle case where canvasData might be a serialized string in deeply old files
              const rawCanvasData =
                typeof b.canvasData === 'string'
                  ? (JSON.parse(b.canvasData) as unknown)
                  : (b.canvasData as unknown);
              const wrappedSnapshot =
                typeof rawCanvasData === 'object' &&
                rawCanvasData !== null &&
                'snapshot' in rawCanvasData
                  ? (rawCanvasData as { snapshot: unknown }).snapshot
                  : rawCanvasData;
              const parsedCanvasData =
                typeof wrappedSnapshot === 'string'
                  ? (JSON.parse(wrappedSnapshot) as Record<string, unknown>)
                  : (wrappedSnapshot as Record<string, unknown>);

              // Only attempt pre-hydration if LC is globally available (standard browser environment)
              if (typeof LC !== 'undefined' && LC.snapshotJSONToShapes) {
                try {
                  shapes = parsedCanvasData['shapes']
                    ? (LC.snapshotJSONToShapes(
                        parsedCanvasData['shapes'] as Record<string, unknown>[]
                      ) as unknown[])
                    : [];
                  backgroundShapes = parsedCanvasData['backgroundShapes']
                    ? (LC.snapshotJSONToShapes(
                        parsedCanvasData['backgroundShapes'] as Record<string, unknown>[]
                      ) as unknown[])
                    : [];
                } catch (e) {
                  console.warn('Failed to pre-hydrate LC shapes for board', b.id, e);
                  shapes = [];
                  backgroundShapes = [];
                }
              }

              canvasDataService.setCanvasData(b.id, {
                snapshot: parsedCanvasData,
                shapes: shapes.length > 0 ? shapes : undefined,
                backgroundShapes: backgroundShapes.length > 0 ? backgroundShapes : undefined,
              });
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { canvasData, ...rest } = b;
            return rest;
          });

          const laneCount =
            typeof data.audioLaneCount === 'number' && Number.isInteger(data.audioLaneCount)
              ? Math.max(1, data.audioLaneCount)
              : 1;
          const defaultMixers = Array.from({ length: laneCount }, () => ({
            volume: 1,
            muted: false,
          }));
          const rawLaneMixers = Array.isArray(data.audioLaneMixers) ? data.audioLaneMixers : null;
          const laneMixers =
            rawLaneMixers &&
            rawLaneMixers.every(
              (mixer) => typeof mixer === 'object' && mixer !== null && !Array.isArray(mixer)
            )
              ? rawLaneMixers.map((mixer) => ({
                  volume: typeof mixer.volume === 'number' ? mixer.volume : 1,
                  muted: typeof mixer.muted === 'boolean' ? mixer.muted : false,
                }))
              : defaultMixers;

          const rawAudioTracks = Array.isArray(data.audioTracks) ? data.audioTracks : [];
          const normalizedTracks = rawAudioTracks
            .filter((track) => typeof track === 'object' && track !== null && !Array.isArray(track))
            .map((track) => ({
              ...track,
              volume:
                typeof track.volume === 'number'
                  ? track.volume
                  : laneMixers[typeof track.laneIndex === 'number' ? track.laneIndex : -1]
                      ?.volume ?? 1,
            }));

          const dimensions = extractProjectDimensions(
            data,
            cleanedBoards as { id: string }[],
            canvasDataService
          );

          patchState(store, {
            boards: cleanedBoards as Board[],
            currentBoardId: data.currentBoardId || data.boards[0]?.id || null,
            onionSkinEnabled: data.onionSkinEnabled ?? false,
            audioTracks: normalizedTracks,
            audioLaneCount: laneCount,
            audioLaneMixers: laneMixers,
            fps: dimensions.fps,
            width: dimensions.width,
            height: dimensions.height,
          });
        } catch (error) {
          console.error('Failed to load JSON:', error);
          throw new Error('Invalid JSON format or structure');
        }
      },

      updateBoardDuration(boardId: string, duration: number) {
        const boards = store
          .boards()
          .map((board) => (board.id === boardId ? { ...board, duration } : board));
        patchState(store, { boards });
      },

      toggleBoardBoil(boardId: string) {
        const boards = store
          .boards()
          .map((board) =>
            board.id === boardId ? { ...board, boilEnabled: !board.boilEnabled } : board
          );
        patchState(store, { boards });
      },

      setBoardBoilParams(
        boardId: string,
        params: { variations?: number; holdFrames?: number; amount?: number }
      ) {
        const boards = store
          .boards()
          .map((board) =>
            board.id === boardId
              ? { ...board, boilParams: { ...board.boilParams, ...params } }
              : board
          );
        patchState(store, { boards });
      },

      reorderBoards(fromIndex: number, toIndex: number) {
        const boards = [...store.boards()];
        const [movedBoard] = boards.splice(fromIndex, 1);
        boards.splice(toIndex, 0, movedBoard);
        patchState(store, { boards });
      },

      setIsPlaying(isPlaying: boolean) {
        patchState(store, { isPlaying });
      },

      setCurrentTime(time: number) {
        patchState(store, { currentTime: time });
      },

      setFps(fps: number) {
        const sanitized = sanitizeFps(fps, store.fps());
        patchState(store, { fps: sanitized });
      },

      setResolution(width: number, height: number) {
        const sanitized = sanitizeResolution(width, height, store.width(), store.height());
        patchState(store, { width: sanitized.width, height: sanitized.height });
      },

      updateAudioUrl(trackId: string, url: string) {
        patchState(store, (state) => ({
          audioTracks: state.audioTracks.map((t) => (t.id === trackId ? { ...t, url } : t)),
        }));
      },

      setOnionSkinEnabled(onionSkinEnabled: boolean) {
        patchState(store, { onionSkinEnabled });
      },

      toggleOnionSkin() {
        patchState(store, { onionSkinEnabled: !store.onionSkinEnabled() });
      },

      setOnionFramesBack(onionFramesBack: number) {
        patchState(store, {
          onionFramesBack: Math.max(0, Math.min(10, Math.round(onionFramesBack))),
        });
      },

      setOnionFramesForward(onionFramesForward: number) {
        patchState(store, {
          onionFramesForward: Math.max(0, Math.min(10, Math.round(onionFramesForward))),
        });
      },

      setOnionPrevColor(onionPrevColor: string) {
        patchState(store, { onionPrevColor });
      },

      setOnionNextColor(onionNextColor: string) {
        patchState(store, { onionNextColor });
      },

      addAudioTrack(track: AudioTrack) {
        patchState(store, (state) => ({
          audioTracks: [...state.audioTracks, track],
        }));
      },

      removeAudioTrack(trackId: string) {
        patchState(store, (state) => ({
          audioTracks: state.audioTracks.filter((t) => t.id !== trackId),
        }));
      },

      updateAudioStartTime(trackId: string, newStartTime: number) {
        patchState(store, (state) => ({
          audioTracks: state.audioTracks.map((t) =>
            t.id === trackId ? { ...t, startTime: newStartTime } : t
          ),
        }));
      },

      updateAudioTrim(trackId: string, startTime: number, duration: number, trimStart: number) {
        patchState(store, (state) => ({
          audioTracks: state.audioTracks.map((t) =>
            t.id === trackId ? { ...t, startTime, duration, trimStart } : t
          ),
        }));
      },

      addAudioLane() {
        if (store.audioLaneCount() < 4) {
          patchState(store, {
            audioLaneCount: store.audioLaneCount() + 1,
            audioLaneMixers: [
              ...store.audioLaneMixers(),
              { volume: appSettings.audio.defaultVolume, muted: false },
            ],
          });
        }
      },

      setAudioLaneVolume(laneIndex: number, volume: number) {
        const mixers = store
          .audioLaneMixers()
          .map((m, i) => (i === laneIndex ? { ...m, volume } : m));
        patchState(store, { audioLaneMixers: mixers });
      },

      updateAudioVolume(trackId: string, volume: number) {
        patchState(store, (state) => ({
          audioTracks: state.audioTracks.map((t) => (t.id === trackId ? { ...t, volume } : t)),
        }));
      },

      setAudioLaneMuted(laneIndex: number, muted: boolean) {
        const mixers = store
          .audioLaneMixers()
          .map((m, i) => (i === laneIndex ? { ...m, muted } : m));
        patchState(store, { audioLaneMixers: mixers });
      },

      updateAudioLane(trackId: string, laneIndex: number) {
        patchState(store, (state) => ({
          audioTracks: state.audioTracks.map((t) => (t.id === trackId ? { ...t, laneIndex } : t)),
        }));
      },

      removeAudioLane(laneIndex: number) {
        patchState(store, (state) => ({
          // Drop clips on the removed lane; shift higher-indexed lanes down by 1
          audioTracks: state.audioTracks
            .filter((t) => t.laneIndex !== laneIndex)
            .map((t) => (t.laneIndex > laneIndex ? { ...t, laneIndex: t.laneIndex - 1 } : t)),
          audioLaneCount: Math.max(1, state.audioLaneCount - 1),
          audioLaneMixers: state.audioLaneMixers.filter((_, i) => i !== laneIndex),
        }));
      },

      /**
       * Restore a previously-deleted board at a specific index.
       * Used exclusively by the undo system.
       */
      restoreBoard(board: Board, index: number) {
        const boards = [...store.boards()];
        const clampedIndex = Math.max(0, Math.min(index, boards.length));
        boards.splice(clampedIndex, 0, board);
        patchState(store, { boards });
      },
    };
  }),
  withComputed((store) => ({
    totalDuration: computed(() => {
      return store.boards().reduce((acc, b) => acc + (b.duration || 3), 0);
    }),
  }))
);
