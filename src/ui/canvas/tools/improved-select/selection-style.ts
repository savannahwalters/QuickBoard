export function selectionColors(): { border: string; handle: string } {
  const style = getComputedStyle(document.documentElement);
  return {
    border: style.getPropertyValue('--accent-border').trim() || '#c464f6',
    handle: style.getPropertyValue('--accent').trim() || '#c97fff',
  };
}
