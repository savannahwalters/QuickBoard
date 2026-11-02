import definitions from './shortcuts.json';

export const shortcuts = definitions;
export type Shortcut = (typeof shortcuts)[number];

export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

export function matchShortcut(event: KeyboardEvent, mac = isMacPlatform()): Shortcut | undefined {
  if (event.isComposing || event.getModifierState('AltGraph')) return undefined;
  const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
  return shortcuts.find((shortcut) => {
    const modifiers = shortcut.modifiers;
    return (
      shortcut.key === key &&
      modifiers.includes('primary') === (mac ? event.metaKey : event.ctrlKey) &&
      !(mac ? event.ctrlKey : event.metaKey) &&
      modifiers.includes('alt') === event.altKey &&
      (modifiers.includes('shift') === event.shiftKey || (key === '+' && event.shiftKey))
    );
  });
}

export function shortcutKeys(shortcut: Shortcut, mac = isMacPlatform()): string[] {
  const labels: Record<string, string> = {
    primary: mac ? 'Cmd' : 'Ctrl',
    shift: 'Shift',
    alt: mac ? 'Option' : 'Alt',
    arrowleft: 'Left',
    arrowright: 'Right',
    backspace: mac ? 'Delete' : 'Backspace',
    space: 'Space',
  };
  return [...shortcut.modifiers, shortcut.key].map(
    (key) =>
      labels[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1))
  );
}
