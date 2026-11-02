import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import {
  hsvToRgb,
  triangleColor,
  trianglePoint,
  wheelColor,
  wheelPoint,
} from './color-picker-geometry';

export interface SelectorChange {
  h?: number;
  s?: number;
  v?: number;
}

@Component({
  selector: 'app-circular-color-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="selector">
      <canvas
        #surface
        width="384"
        height="384"
        role="slider"
        tabindex="0"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-label]="
          label() + (mode() === 'triangle' ? ' saturation and value' : ' hue and saturation')
        "
        [attr.aria-valuenow]="saturation() * 100"
        [attr.aria-valuetext]="valueText()"
        (pointerdown)="startDrag($event)"
        (pointermove)="moveDrag($event)"
        (pointerup)="endDrag($event)"
        (pointercancel)="endDrag($event)"
        (lostpointercapture)="endDrag($event)"
        (keydown)="onKeydown($event)"
      ></canvas>
      <span
        class="handle"
        [style.left.%]="handle().x * 100"
        [style.top.%]="handle().y * 100"
      ></span>
      @if (mode() === 'triangle') {
      <span
        class="handle hue-handle"
        [style.left.%]="hueHandle().x * 100"
        [style.top.%]="hueHandle().y * 100"
      ></span>
      }
    </div>
  `,
  styles: `
    :host { display: block; width: 100%; }
    .selector { position: relative; width: 100%; aspect-ratio: 1; }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; border-radius: 4px; }
    canvas:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
    .handle { position: absolute; width: 10px; height: 10px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 0 1px black; transform: translate(-50%, -50%); pointer-events: none; }
    .hue-handle { width: 8px; height: 8px; }
  `,
})
export class CircularColorSelectorComponent {
  readonly mode = input.required<'triangle' | 'wheel'>();
  readonly label = input.required<string>();
  readonly hue = input.required<number>();
  readonly saturation = input.required<number>();
  readonly value = input.required<number>();
  readonly selectionChange = output<SelectorChange>();
  readonly surface = viewChild<ElementRef<HTMLCanvasElement>>('surface');
  readonly handle = computed(() =>
    this.mode() === 'triangle'
      ? trianglePoint(this.saturation(), this.value())
      : wheelPoint(this.hue(), this.saturation())
  );
  readonly hueHandle = computed(() => wheelPoint(this.hue(), 1, 0.425));
  readonly valueText = computed(
    () =>
      `Hue ${Math.round(this.hue())} degrees, Saturation ${Math.round(
        this.saturation() * 100
      )} percent, Value ${Math.round(this.value() * 100)} percent`
  );
  private pointerId: number | null = null;
  private dragRegion: 'hue' | 'triangle' | 'wheel' = 'triangle';

  constructor() {
    effect(() => {
      const canvas = this.surface()?.nativeElement;
      const mode = this.mode();
      const hue = mode === 'triangle' ? this.hue() : 0;
      const value = mode === 'wheel' ? this.value() : 1;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      const size = canvas.width;
      const image = context.createImageData(size, size);
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          const point = { x: (column + 0.5) / size, y: (row + 0.5) / size };
          const radius = Math.hypot(point.x - 0.5, point.y - 0.5);
          let rgb: { r: number; g: number; b: number };
          if (mode === 'wheel') {
            if (radius > 0.48) continue;
            const color = wheelColor(point);
            rgb = hsvToRgb(color.h, color.s, value);
          } else if (radius >= 0.37 && radius <= 0.48) {
            rgb = hsvToRgb(wheelColor(point).h, 1, 1);
          } else {
            const color = triangleColor(point, false);
            if (!color) continue;
            rgb = hsvToRgb(hue, color.s, color.v);
          }
          const offset = (row * size + column) * 4;
          image.data[offset] = rgb.r;
          image.data[offset + 1] = rgb.g;
          image.data[offset + 2] = rgb.b;
          image.data[offset + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
    });
  }

  startDrag(event: PointerEvent): void {
    if (event.button !== 0 || this.pointerId !== null) return;
    const canvas = event.currentTarget as HTMLCanvasElement;
    const point = this.eventPoint(event, canvas);
    const radius = Math.hypot(point.x - 0.5, point.y - 0.5);
    if (radius > 0.5) return;
    if (this.mode() === 'wheel') this.dragRegion = 'wheel';
    else if (radius >= 0.37) this.dragRegion = 'hue';
    else if (triangleColor(point, false)) this.dragRegion = 'triangle';
    else return;
    event.preventDefault();
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    this.pointerId = event.pointerId;
    this.updateSelection(event, canvas);
  }

  moveDrag(event: PointerEvent): void {
    if (this.pointerId === event.pointerId)
      this.updateSelection(event, event.currentTarget as HTMLCanvasElement);
  }

  endDrag(event: PointerEvent): void {
    if (this.pointerId === event.pointerId) this.pointerId = null;
  }

  onKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.1 : 0.01;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    if (this.mode() === 'wheel') {
      this.selectionChange.emit(
        horizontal
          ? { h: (this.hue() + direction * step * 360 + 360) % 360 }
          : { s: clamp(this.saturation() + direction * step) }
      );
    } else {
      this.selectionChange.emit(
        horizontal
          ? { s: clamp(this.saturation() + direction * step) }
          : { v: clamp(this.value() + direction * step) }
      );
    }
  }

  private eventPoint(event: PointerEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  private updateSelection(event: PointerEvent, canvas: HTMLCanvasElement): void {
    const point = this.eventPoint(event, canvas);
    if (this.dragRegion === 'triangle') {
      const color = triangleColor(point)!;
      this.selectionChange.emit({ s: color.v === 0 ? this.saturation() : color.s, v: color.v });
    } else {
      const color = wheelColor(point);
      this.selectionChange.emit(
        this.dragRegion === 'hue'
          ? { h: color.h }
          : { h: color.s === 0 ? this.hue() : color.h, s: color.s }
      );
    }
  }
}
