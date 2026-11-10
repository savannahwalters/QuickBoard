import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ToolsBarComponent } from './tools-bar.component';

describe('selection tool icons', () => {
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
