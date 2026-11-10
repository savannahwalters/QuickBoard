import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasComponent } from './canvas.component';
import { CanvasShortcutsController } from './canvas-shortcuts-controller';

describe('selection deletion shortcuts', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  function setup() {
    const deleteSelection = vi.fn(() => true);
    const canvas = {
      document,
      deleteSelection,
      el: { nativeElement: document.body },
    } as unknown as CanvasComponent;
    return { controller: new CanvasShortcutsController(canvas), deleteSelection };
  }

  it.each(['Backspace', 'Delete'])('deletes selected objects with %s', (key) => {
    const { controller, deleteSelection } = setup();
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    controller.handleKeyDown(event);
    expect(deleteSelection).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the key untouched when nothing is selected', () => {
    const { controller, deleteSelection } = setup();
    deleteSelection.mockReturnValue(false);
    const event = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    controller.handleKeyDown(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['input', 'textarea', 'div'])('does not delete canvas items while editing %s', (tag) => {
    const { controller, deleteSelection } = setup();
    const editor = document.createElement(tag);
    if (tag === 'div') {
      editor.contentEditable = 'true';
      editor.tabIndex = 0;
      Object.defineProperty(editor, 'isContentEditable', { value: true });
    }
    document.body.append(editor);
    editor.focus();
    const event = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    controller.handleKeyDown(event);
    expect(deleteSelection).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }])(
    'does not override modified keys or composition: %o',
    (options) => {
      const { controller, deleteSelection } = setup();
      controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Backspace', ...options }));
      expect(deleteSelection).not.toHaveBeenCalled();
    }
  );
});
