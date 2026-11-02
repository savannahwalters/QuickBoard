import { describe, expect, it } from 'vitest';
import { matchShortcut, shortcutKeys, shortcuts } from './shortcuts';

describe('shared keyboard shortcuts', () => {
  it('uses Command on macOS and Control on Windows', () => {
    expect(matchShortcut(new KeyboardEvent('keydown', { key: 's', metaKey: true }), true)?.id).toBe(
      'save'
    );
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }), false)?.id
    ).toBe('save');
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }), true)
    ).toBeUndefined();
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: 's', metaKey: true }), false)
    ).toBeUndefined();
  });

  it('reserves Command-comma for settings, not board navigation', () => {
    expect(matchShortcut(new KeyboardEvent('keydown', { key: ',', metaKey: true }), true)?.id).toBe(
      'settings'
    );
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: ',', metaKey: true }), true)?.menu
    ).toBe(true);
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: 'Home', metaKey: true }), true)?.id
    ).toBe('first-board');
    expect(matchShortcut(new KeyboardEvent('keydown', { key: ',' }), true)?.id).toBe(
      'previous-board'
    );
  });

  it('recognizes native close and quit without inventing unknown bindings', () => {
    for (const [key, id] of [
      ['w', 'close'],
      ['q', 'quit'],
    ]) {
      const shortcut = matchShortcut(new KeyboardEvent('keydown', { key, metaKey: true }), true);
      expect(shortcut?.id).toBe(id);
      expect(shortcut?.menu).toBe(true);
    }
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: 'k', metaKey: true }), true)
    ).toBeUndefined();
  });

  it('matches exact modifiers, shifted redo, and the shifted plus character', () => {
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: 'Z', shiftKey: true, metaKey: true }), true)
        ?.id
    ).toBe('redo');
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: 's', altKey: true, metaKey: true }), true)
    ).toBeUndefined();
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: '+', shiftKey: true }), true)?.id
    ).toBe('timeline-zoom-in');
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: ' ', altKey: true }), true)
    ).toBeUndefined();
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: 's', isComposing: true }), true)
    ).toBeUndefined();
  });

  it('has no conflicting bindings and renders labels from the same definitions', () => {
    const bindings = shortcuts.map((shortcut) => `${shortcut.modifiers.join('+')}:${shortcut.key}`);
    expect(new Set(bindings).size).toBe(bindings.length);
    const save = shortcuts.find((shortcut) => shortcut.id === 'save')!;
    expect(shortcutKeys(save, true)).toEqual(['Cmd', 'S']);
    expect(shortcutKeys(save, false)).toEqual(['Ctrl', 'S']);
  });
});
