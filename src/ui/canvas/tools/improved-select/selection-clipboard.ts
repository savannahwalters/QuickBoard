import { prepareTransform, snapshotShapes, translateShapes } from './shape-transforms';

let copiedShapes: Record<string, unknown>[] = [];
let copiedImage: Blob | null = null;
let copyGeneration = 0;
let clipboardWrite: Promise<void> = Promise.resolve();
let latestCopy: Promise<void> = Promise.resolve();

export function setCopiedShapes(shapes: Record<string, unknown>[]): number {
  copiedShapes = shapes;
  copiedImage = null;
  latestCopy = Promise.resolve();
  return ++copyGeneration;
}

export function writeCopiedImage(
  generation: number,
  image: Blob | Promise<Blob | null>
): Promise<void> {
  const copy = Promise.resolve(image).then(async (blob) => {
    if (generation !== copyGeneration) return;
    if (!blob) {
      console.error('Unable to render selected objects for the system clipboard.');
      return;
    }
    const write = clipboardWrite.then(async () => {
      if (generation !== copyGeneration) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      if (generation === copyGeneration) copiedImage = blob;
    });
    clipboardWrite = write.catch((error) => {
      console.warn('Unable to copy the selection to the system image clipboard.', error);
    });
    await clipboardWrite;
  });
  const completed = copy.catch((error) => {
    console.warn('Unable to encode the selection for the system image clipboard.', error);
  });
  if (generation === copyGeneration) latestCopy = completed;
  return completed;
}

export async function readSelectionClipboard(): Promise<
  { shapes: Record<string, unknown>[] } | { image: Blob } | null
> {
  let pending: Promise<void>;
  do {
    pending = latestCopy;
    await pending;
  } while (pending !== latestCopy);
  const image = await readSystemImage();
  if (image === undefined) return { shapes: createPastedShapes() };
  if (!image) return null;
  if (copiedImage && image.type === copiedImage.type && image.size === copiedImage.size) {
    const [current, saved] = await Promise.all([image.arrayBuffer(), copiedImage.arrayBuffer()]);
    const bytes = new Uint8Array(saved);
    if (new Uint8Array(current).every((byte, index) => byte === bytes[index])) {
      return { shapes: createPastedShapes() };
    }
  }
  return { image };
}

async function readSystemImage(): Promise<Blob | null | undefined> {
  if (!navigator.clipboard?.read) return undefined;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type =
        item.types.find((type) => type === 'image/png') ??
        item.types.find((type) => type.startsWith('image/'));
      if (!type) continue;
      return await item.getType(type);
    }
    return null;
  } catch (error) {
    console.warn(
      'Unable to read the system clipboard; using the internal selection clipboard.',
      error
    );
    return undefined;
  }
}

export function createPastedShapes(): Record<string, unknown>[] {
  const pasted = copiedShapes.map((data) => LC.JSONToShape(data) as Record<string, unknown>);
  pasted.forEach((shape) => prepareTransform(shape, 'move'));
  translateShapes(snapshotShapes(pasted), 20, 20);
  return pasted;
}
