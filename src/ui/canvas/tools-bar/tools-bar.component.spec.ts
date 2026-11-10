import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolsBarComponent } from './tools-bar.component';

describe('canvas toolbar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('uses the desktop picker instead of a browser input for menu-triggered import', async () => {
    const pickImageFile = vi.fn().mockResolvedValue({
      success: true,
      name: 'art.svg',
      type: 'image/svg+xml',
      data: btoa('<svg/>'),
    });
    vi.stubGlobal('quickboard', { pickImageFile });
    const fixture = TestBed.createComponent(ToolsBarComponent);
    fixture.componentRef.setInput('activeTool', 'pencil');
    const emit = vi.spyOn(fixture.componentInstance.imageSelected, 'emit');
    fixture.componentInstance.requestImageImport();
    await vi.waitFor(() => expect(emit).toHaveBeenCalledOnce());
    const file = emit.mock.calls[0][0];
    expect(file.name).toBe('art.svg');
    expect(file.type).toBe('image/svg+xml');
    expect(file.size).toBe(6);
    expect(pickImageFile).toHaveBeenCalledOnce();
    fixture.destroy();
  });

  it('reports desktop picker failures and treats cancellation as no import', async () => {
    const pickImageFile = vi.fn().mockResolvedValue({ success: true, cancelled: true });
    vi.stubGlobal('quickboard', { pickImageFile });
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(ToolsBarComponent);
    fixture.componentRef.setInput('activeTool', 'pencil');
    const emit = vi.spyOn(fixture.componentInstance.imageSelected, 'emit');
    fixture.componentInstance.requestImageImport();
    await Promise.resolve();
    expect(emit).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    pickImageFile.mockResolvedValue({ success: false, message: 'Cannot read image' });
    fixture.componentInstance.requestImageImport();
    await vi.waitFor(() =>
      expect(alert).toHaveBeenCalledWith('Failed to import image: Cannot read image')
    );
    fixture.destroy();
  });
  it('renders distinct dotted SVGs in the toolbar and selection submenu', async () => {
    await TestBed.configureTestingModule({ imports: [ToolsBarComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ToolsBarComponent);
    fixture.componentRef.setInput('activeTool', 'rectangle-select');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[aria-label="Rectangle Select"] svg path')?.getAttribute('d')
    ).toBe('M4 4H20V20H4Z');

    fixture.componentInstance.openToolSubmenu.set('edit');
    fixture.detectChanges();
    const icons = element.querySelectorAll('[role="menuitem"] svg path');
    expect(icons).toHaveLength(4);
    expect(new Set([...icons].map((icon) => icon.getAttribute('d'))).size).toBe(4);
    expect([...icons].map((icon) => icon.getAttribute('pathLength'))).toEqual([
      '64',
      '60',
      null,
      null,
    ]);
    expect(
      element.querySelector('[aria-label="Lasso Select"] path[stroke-dasharray="none"]')
    ).toBeNull();
    for (const option of fixture.componentInstance.editTools) {
      fixture.componentRef.setInput('activeTool', option.id);
      fixture.detectChanges();
      expect(element.querySelector('.tool-group-button.active svg path')?.getAttribute('d')).toBe(
        option.iconPath
      );
    }
    fixture.destroy();
  });
});
