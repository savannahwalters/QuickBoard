export function getResizeCursorForAngle(angleRad: number): string {
  const deg = ((((angleRad * 180) / Math.PI) % 180) + 180) % 180;
  if (deg < 22.5 || deg >= 157.5) return 'ew-resize';
  if (deg < 67.5) return 'nwse-resize';
  if (deg < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

export function getRotateCursor(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="24" height="24"><path d="M16 4 A12 12 0 0 1 26.83 7.17" stroke="#333" stroke-width="2" fill="none" stroke-linecap="round"/><polygon points="26,2 30,8 24,6" fill="#333"/><path d="M16 28 A12 12 0 0 1 5.17 24.83" stroke="#333" stroke-width="2" fill="none" stroke-linecap="round"/><polygon points="6,26 2,32 8,30" fill="#333"/></svg>`;
  const encoded = encodeURIComponent(svg);
  return `url('data:image/svg+xml;utf8,${encoded}') 12 12, auto`;
}
