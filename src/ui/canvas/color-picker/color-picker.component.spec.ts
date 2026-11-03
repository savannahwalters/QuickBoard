import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorPickerComponent } from './color-picker.component';
import { CircularColorSelectorComponent } from './circular-color-selector.component';
import { hsvToRgb } from './color-picker-geometry';
import { getColorPickerRaster } from './color-picker-raster';
import { triangleColor, wheelColor } from './color-picker-geometry';

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
    expect(
      fixture.nativeElement.querySelectorAll(
        '.vertical-channels input[aria-orientation="vertical"]'
      )
    ).toHaveLength(3);
    expect(
      fixture.nativeElement.querySelector('.alpha-slider').getAttribute('aria-orientation')
    ).not.toBe('vertical');
    expect(component.hueGradient()).toContain('to top');
    expect(component.valueGradient()).toContain('to top');
    expect(component.alphaGradient()).toContain('to right');
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

  it('renders a larger triangle without a hue ring', () => {
    const image = putImageData.mock.calls.at(-1)![0] as ImageData;
    const pixel = (x: number, y: number) =>
      Array.from(image.data.slice((y * 384 + x) * 4, (y * 384 + x) * 4 + 4));
    expect(pixel(355, 192)[3]).toBe(0);
    expect(pixel(192, 192)[3]).toBe(255);
    expect(pixel(192, 48)[3]).toBe(255);
    expect(pixel(48, 330)[3]).toBe(255);
    expect(pixel(0, 0)[3]).toBe(0);
    expect(fixture.nativeElement.querySelector('.hue-handle')).toBeNull();
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
    expect(
      fixture.nativeElement.querySelector(`#${component.valueId}`).getAttribute('aria-orientation')
    ).toBe('horizontal');
    expect(fixture.nativeElement.querySelector('.vertical-channels')).toBeNull();
    expect(component.valueGradient()).toContain('to right');
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

  it('drags the enlarged triangle without changing hue and ignores unrelated pointers', () => {
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
    selector.startDrag(pointer(100, 50));
    const original = component.displayColor();
    selector.moveDrag(pointer(100, 120, 2));
    expect(component.displayColor()).toBe(original);
    expect(component.hue()).toBe(0);
    selector.moveDrag(pointer(100, 120));
    expect(component.hue()).toBe(0);
    expect(component.value()).toBeLessThan(1);
    expect(component.alpha()).toBe(0.4);
    selector.endDrag(pointer(100, 120));
    const finalColor = component.displayColor();
    selector.moveDrag(pointer(15, 100));
    expect(component.displayColor()).toBe(finalColor);
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

  it('shows alpha percent beside its slider without the old information footer', () => {
    const input = fixture.nativeElement.querySelector('.alpha-slider') as HTMLInputElement;
    const output = fixture.nativeElement.querySelector(`output[for="${component.alphaId}"]`);
    expect(output.textContent.trim()).toBe('40%');
    input.value = '65';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(output.textContent.trim()).toBe('65%');
    expect(component.alpha()).toBe(0.65);
    expect(fixture.nativeElement.querySelector('.preview-row')).toBeNull();
    expect(fixture.nativeElement.querySelector('.hex-input')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="number"]')).toBeNull();
  });

  it('preserves exact incoming color channels', () => {
    fixture.componentRef.setInput('color', '#e64c80');
    fixture.detectChanges();
    expect(component.hexValue()).toBe('#E64C80');
  });

  it('shows an editable hex field only beneath the Sliders controls', () => {
    for (const option of component.modes) {
      component.selectMode(option.id);
      fixture.detectChanges();
      expect(!!fixture.nativeElement.querySelector('.hex-input')).toBe(option.id === 'sliders');
    }
    const input = fixture.nativeElement.querySelector('.hex-input') as HTMLInputElement;
    input.dispatchEvent(new Event('focus'));
    input.value = '#e64c80';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.hexValue()).toBe('#E64C80');
    expect(component.alpha()).toBe(0.4);
    input.value = 'invalid';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(input.value).toBe('#E64C80');
  });

  it('supports short hex and explicit alpha while keeping the hex field in sync', () => {
    component.selectMode('sliders');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.hex-input') as HTMLInputElement;
    input.value = '#0f0';
    input.dispatchEvent(new Event('input'));
    expect(component.hexValue()).toBe('#00FF00');
    expect(component.alpha()).toBe(0.4);
    input.value = '#33669980';
    input.dispatchEvent(new Event('input'));
    expect(component.hexValue()).toBe('#336699');
    expect(component.alphaPercentValue()).toBe(50);
    input.dispatchEvent(new Event('blur'));
    component.onSelectionChange({ v: 1 });
    fixture.detectChanges();
    expect(input.value).toBe(component.hexValue());
  });

  it('clamps the popup to the viewport even when the toolbar is off-screen', () => {
    vi.spyOn(fixture.nativeElement, 'getBoundingClientRect').mockReturnValue({
      right: 1400,
      bottom: window.innerHeight + 228,
      top: window.innerHeight + 200,
    } as DOMRect);
    vi.spyOn(
      fixture.nativeElement.querySelector('.color-panel'),
      'getBoundingClientRect'
    ).mockReturnValue({ width: 240, height: 200 } as DOMRect);
    component.onWindowResize();
    expect(component.panelLeft()).toBeLessThanOrEqual(window.innerWidth - 240 - 8);
    expect(component.panelLeft()).toBeGreaterThanOrEqual(8);
    expect(component.panelTop()).toBe(window.innerHeight - 200 - 8);
  });

  it('uses the rendered height to place a panel below the trigger when it fits', () => {
    const bottom = window.innerHeight - 222;
    vi.spyOn(fixture.nativeElement, 'getBoundingClientRect').mockReturnValue({
      right: 300,
      top: bottom - 28,
      bottom,
    } as DOMRect);
    const bounds = vi
      .spyOn(fixture.nativeElement.querySelector('.color-panel'), 'getBoundingClientRect')
      .mockReturnValue({ width: 240, height: 200 } as DOMRect);
    component.onWindowResize();
    expect(component.panelTop()).toBe(bottom + 6);
    bounds.mockReturnValue({ width: 240, height: 300 } as DOMRect);
    component.selectMode('sliders');
    fixture.detectChanges();
    expect(component.panelTop()).toBe(Math.max(8, bottom - 28 - 300 - 6));
  });

  it('closes on ancestor scroll but not on internal or unrelated scrolling', () => {
    const panel = fixture.nativeElement.querySelector('.color-panel') as HTMLElement;
    panel.dispatchEvent(new Event('scroll'));
    expect(component.isOpen()).toBe(true);
    const unrelated = document.createElement('div');
    document.body.appendChild(unrelated);
    unrelated.dispatchEvent(new Event('scroll'));
    expect(component.isOpen()).toBe(true);
    unrelated.remove();
    fixture.nativeElement.parentElement.dispatchEvent(new Event('scroll'));
    expect(component.isOpen()).toBe(false);
    fixture.detectChanges();
    component.toggleOpen();
    fixture.detectChanges();
    document.dispatchEvent(new Event('scroll'));
    expect(component.isOpen()).toBe(false);
  });

  it('keeps focus and activation keys inside the picker without preventing native behavior', () => {
    const shortcut = vi.fn();
    fixture.nativeElement.addEventListener('keydown', shortcut);
    const tab = fixture.nativeElement.querySelector('[role="tab"]') as HTMLButtonElement;
    for (const key of ['Tab', ' ', 'Enter']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      tab.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(shortcut).not.toHaveBeenCalled();
  });

  it('exposes independent native channel controls for both circular selector modes', () => {
    for (const mode of ['triangle', 'wheel'] as const) {
      component.selectMode(mode);
      fixture.detectChanges();
      const selector = fixture.nativeElement.querySelector(
        'app-circular-color-selector'
      ) as HTMLElement;
      const inputs = selector.querySelectorAll<HTMLInputElement>('input[type="range"]');
      expect(inputs).toHaveLength(2);
      expect(selector.querySelector('canvas')?.getAttribute('role')).toBe('group');
      expect(inputs[0].getAttribute('aria-label')).toBe(
        mode === 'triangle' ? 'Stroke saturation' : 'Stroke hue'
      );
      expect(inputs[1].getAttribute('aria-label')).toBe(
        mode === 'triangle' ? 'Stroke value' : 'Stroke saturation'
      );
      inputs[0].value = '25';
      inputs[0].dispatchEvent(new Event('input'));
      inputs[1].value = '60';
      inputs[1].dispatchEvent(new Event('input'));
      fixture.detectChanges();
      if (mode === 'triangle') {
        expect(component.saturation()).toBe(0.25);
        expect(component.value()).toBe(0.6);
      } else {
        expect(component.hue()).toBe(25);
        expect(component.saturation()).toBe(0.6);
      }
      expect(inputs[1].value).toBe('60');
      expect(component.alpha()).toBe(0.4);
    }
  });

  it('reuses image buffers and cached geometry during hue and value changes', () => {
    for (const mode of ['triangle', 'wheel'] as const) {
      component.selectMode(mode);
      fixture.detectChanges();
      const initialImage = putImageData.mock.calls.at(-1)![0];
      const angle = vi.spyOn(Math, 'atan2');
      const radius = vi.spyOn(Math, 'hypot');
      component.onSelectionChange(mode === 'wheel' ? { v: 0.25 } : { h: 150 });
      fixture.detectChanges();
      expect(putImageData.mock.calls.at(-1)![0]).toBe(initialImage);
      expect(angle).not.toHaveBeenCalled();
      expect(radius).not.toHaveBeenCalled();
      angle.mockRestore();
      radius.mockRestore();
    }
  });

  it('keeps cached raster pixels consistent with HSV conversion for both modes', () => {
    const size = 32;
    const data = new Uint8ClampedArray(size * size * 4);
    for (const mode of ['triangle', 'wheel'] as const) {
      const raster = getColorPickerRaster(mode, size);
      expect(getColorPickerRaster(mode, size)).toBe(raster);
      for (const hue of [0, 123.4, 275]) {
        raster.paint(data, hue, 0.6);
        for (const [column, row] of [
          [16, 16],
          [16, 5],
          [8, 24],
        ]) {
          const point = { x: (column + 0.5) / size, y: (row + 0.5) / size };
          const triangle = triangleColor(point, false)!;
          const wheel = wheelColor(point);
          const rgb =
            mode === 'triangle'
              ? hsvToRgb(hue, triangle.s, triangle.v)
              : hsvToRgb(wheel.h, wheel.s, 0.6);
          const offset = (row * size + column) * 4;
          expect(Array.from(data.slice(offset, offset + 4))).toEqual([rgb.r, rgb.g, rgb.b, 255]);
        }
      }
    }
  });
});
