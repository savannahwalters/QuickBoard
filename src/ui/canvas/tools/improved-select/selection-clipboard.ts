import { prepareTransform, snapshotShapes, translateShapes } from './shape-transforms';

let copiedShapes: Record<string, unknown>[] = [];

export function setCopiedShapes(shapes: Record<string, unknown>[]): void {
  copiedShapes = shapes;
}

export function createPastedShapes(): Record<string, unknown>[] {
  const pasted = copiedShapes.map((data) => LC.JSONToShape(data) as Record<string, unknown>);
  pasted.forEach((shape) => prepareTransform(shape, 'move'));
  translateShapes(snapshotShapes(pasted), 20, 20);
  return pasted;
}
