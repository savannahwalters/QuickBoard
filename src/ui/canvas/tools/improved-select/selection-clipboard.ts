let copiedShapes: Record<string, unknown>[] = [];

export function setCopiedShapes(shapes: Record<string, unknown>[]): void {
  copiedShapes = shapes;
}

export function getCopiedShapes(): readonly Record<string, unknown>[] {
  return copiedShapes;
}
