import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorPickerComponent } from './color-picker.component';
import { CircularColorSelectorComponent } from './circular-color-selector.component';
import { hsvToRgb } from './color-picker-geometry';

describe('color picker layouts', () => {
  let fixture: ComponentFixture<ColorPickerComponent>;
  let component: ColorPickerComponent;
  const putImageData = vi.fn();

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
      putImageData,
    } as unknown as CanvasRenderingContext2D);
    fixture = TestBed.createComponent(ColorPickerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'Stroke');
    fixture.componentRef.setInput('color', 'rgba(255, 0, 0, 0.4)');
    fixture.detectChanges();
    component.toggleOpen();
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    putImageData.mockClear();
  });

  it('defaults to triangle and preserves color and alpha across all tabs', () => {
    const emitted = vi.fn();
    component.colorChange.subscribe(emitted);
    expect(component.mode()).toBe('triangle');
    const original = component.displayColor();
    for (const option of component.modes) {
      component.selectMode(option.id);
      fixture.detectChanges();
      expect(component.displayColor()).toBe(original);
      expect(component.alpha()).toBe(0.4);
      expect(
        fixture.nativeElement.querySelector('[aria-selected="true"]').getAttribute('aria-label')
      ).toBe(option.name);
    }
    expect(emitted).not.toHaveBeenCalled();
  });

  it('provides exactly three HSV bars in sliders mode plus independent alpha', () => {
    component.selectMode('sliders');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('.selector-body input[type="range"]')
    ).toHaveLength(3);
    const input = fixture.nativeElement.querySelector(`#${component.valueId}`) as HTMLInputElement;
    input.value = '50';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.hexValue()).toBe('#800000');
    expect(component.alpha()).toBe(0.4);
    expect(component.alphaGradient()).toContain('128, 0, 0');
  });

  it('roves tab focus and wraps with arrow keys', () => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
    component.onTabKeydown(event, 0);
    fixture.detectChanges();
    expect(component.mode()).toBe('sliders');
    expect(event.defaultPrevented).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[aria-selected="true"]').getAttribute('tabindex')
    ).toBe('0');
    expect(fixture.nativeElement.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  });

  it('renders triangle and ring pixels and leaves the gap transparent', () => {
    const image = putImageData.mock.calls.at(-1)![0] as ImageData;
    const pixel = (x: number, y: number) =>
      Array.from(image.data.slice((y * 384 + x) * 4, (y * 384 + x) * 4 + 4));
    expect(pixel(355, 192)).toEqual([255, 1, 0, 255]);
    expect(pixel(192, 192)[3]).toBe(255);
    expect(pixel(192, 48)[3]).toBe(255);
    expect(pixel(192, 54)[3]).toBe(0);
    expect(pixel(0, 0)[3]).toBe(0);
  });

  it('renders the disc at the selected value and provides a value bar', () => {
    component.value.set(0.5);
    component.selectMode('wheel');
    fixture.detectChanges();
    const image = putImageData.mock.calls.at(-1)![0] as ImageData;
    const center = (192 * 384 + 192) * 4;
    expect(image.data[center]).toBeGreaterThan(125);
    expect(image.data[center + 1]).toBeGreaterThan(125);
    expect(image.data[center + 3]).toBe(255);
    expect(fixture.nativeElement.querySelector(`#${component.valueId}`)).not.toBeNull();
    expect(fixture.nativeElement.querySelector(`#${component.hueId}`)).toBeNull();
  });

  it('maps the square midpoint to its displayed value', () => {
    component.selectMode('square');
    fixture.detectChanges();
    const area = fixture.nativeElement.querySelector('.sv-area') as HTMLElement;
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 120,
    } as DOMRect);
    area.setPointerCapture = vi.fn();
    component.startSvDrag({
      preventDefault: vi.fn(),
      currentTarget: area,
      pointerId: 1,
      clientX: 200,
      clientY: 60,
    } as unknown as PointerEvent);
    expect(component.value()).toBe(0.5);
    expect(component.valueHandlePercent()).toBe(50);
    expect(component.hexValue()).toBe('#800000');
  });

  it('converts the six HSV primaries consistently with rendered surfaces', () => {
    const expected = [
      [255, 0, 0],
      [255, 255, 0],
      [0, 255, 0],
      [0, 255, 255],
      [0, 0, 255],
      [255, 0, 255],
    ];
    expected.forEach((channels, index) =>
      expect(Object.values(hsvToRgb(index * 60, 1, 1))).toEqual(channels)
    );
  });

  it('locks a ring drag to hue even when the pointer enters the triangle', () => {
    const selector = fixture.debugElement.query(By.directive(CircularColorSelectorComponent))
      .componentInstance as CircularColorSelectorComponent;
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.setPointerCapture = vi.fn();
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
    } as DOMRect);
    const pointer = (clientX: number, clientY: number, pointerId = 1) =>
      ({
        button: 0,
        pointerId,
        clientX,
        clientY,
        currentTarget: canvas,
        preventDefault: vi.fn(),
      } as unknown as PointerEvent);
    selector.startDrag(pointer(185, 100));
    selector.moveDrag(pointer(100, 120, 2));
    expect(component.hue()).toBe(0);
    selector.moveDrag(pointer(100, 120));
    expect(component.hue()).toBe(90);
    expect(component.saturation()).toBe(1);
    expect(component.value()).toBe(1);
    expect(component.alpha()).toBe(0.4);
    selector.endDrag(pointer(100, 120));
    selector.moveDrag(pointer(15, 100));
    expect(component.hue()).toBe(90);
  });

  it('adjusts the circular selector with the keyboard without losing alpha', () => {
    const selector = fixture.debugElement.query(By.directive(CircularColorSelectorComponent))
      .componentInstance as CircularColorSelectorComponent;
    selector.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
    expect(component.value()).toBe(0.9);
    component.selectMode('wheel');
    fixture.detectChanges();
    selector.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(component.hue()).toBeCloseTo(3.6);
    expect(component.value()).toBe(0.9);
    expect(component.alpha()).toBe(0.4);
  });

  it('preserves exact hex channels instead of rounding hue to whole degrees', () => {
    const input = fixture.nativeElement.querySelector('.hex-input') as HTMLInputElement;
    input.value = '#e64c80';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.hexValue()).toBe('#E64C80');
  });

  it('clamps the popup to the viewport even when the toolbar is off-screen', () => {
    component.toggleOpen();
    vi.spyOn(fixture.nativeElement, 'getBoundingClientRect').mockReturnValue({
      right: 1400,
      bottom: 70,
      top: 42,
    } as DOMRect);
    component.toggleOpen();
    expect(component.panelLeft()).toBeLessThanOrEqual(window.innerWidth - 240 - 8);
    expect(component.panelLeft()).toBeGreaterThanOrEqual(8);
  });
});
