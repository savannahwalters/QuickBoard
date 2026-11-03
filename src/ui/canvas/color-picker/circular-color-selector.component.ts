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
import { triangleColor, trianglePoint, wheelColor, wheelPoint } from './color-picker-geometry';
import { getColorPickerRaster } from './color-picker-raster';

let selectorId = 0;

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
        role="group"
        tabindex="0"
        [attr.aria-label]="
          label() + (mode() === 'triangle' ? ' saturation and value' : ' hue and saturation')
        "
        [attr.aria-description]="valueText()"
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
      <div class="accessible-channels">
        @for (channel of accessibleChannels(); track channel.key) {
        <div class="accessible-channel">
          <label [attr.for]="channelId + '-' + channel.key">{{ channel.label }}</label>
          <input
            type="range"
            [id]="channelId + '-' + channel.key"
            min="0"
            [max]="channel.max"
            step="1"
            [value]="channel.value"
            [attr.aria-label]="label() + ' ' + channel.label.toLowerCase()"
            [attr.aria-valuetext]="channel.value.toFixed(0) + channel.unit"
            (input)="onAccessibleInput($event, channel.key)"
          />
          <output [attr.for]="channelId + '-' + channel.key"
            >{{ channel.value.toFixed(0) }}{{ channel.unit }}</output
          >
        </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; width: 100%; }
    .selector { position: relative; width: 100%; aspect-ratio: 1; }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; border-radius: 4px; }
    canvas:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
    .handle { position: absolute; width: 10px; height: 10px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 0 1px black; transform: translate(-50%, -50%); pointer-events: none; }
    .accessible-channels { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .accessible-channels:focus-within { width: auto; height: auto; left: 0; right: 0; bottom: 0; padding: 6px; clip-path: none; overflow: visible; background: var(--bg-panel); color: var(--text-default); border: 1px solid var(--border-default); border-radius: 4px; }
    .accessible-channel { display: grid; grid-template-columns: 64px minmax(0, 1fr) 36px; align-items: center; gap: 4px; font-size: 10px; }
    .accessible-channel input { min-width: 0; width: 100%; }
    .accessible-channel output { text-align: right; }
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
  readonly channelId = `circular-selector-channel-${++selectorId}`;
  readonly accessibleChannels = computed(() =>
    this.mode() === 'triangle'
      ? [
          {
            key: 's' as const,
            label: 'Saturation',
            value: this.saturation() * 100,
            max: 100,
            unit: '%',
          },
          { key: 'v' as const, label: 'Value', value: this.value() * 100, max: 100, unit: '%' },
        ]
      : [
          { key: 'h' as const, label: 'Hue', value: this.hue(), max: 360, unit: ' degrees' },
          {
            key: 's' as const,
            label: 'Saturation',
            value: this.saturation() * 100,
            max: 100,
            unit: '%',
          },
        ]
  );
  readonly handle = computed(() =>
    this.mode() === 'triangle'
      ? trianglePoint(this.saturation(), this.value())
      : wheelPoint(this.hue(), this.saturation())
  );
  readonly valueText = computed(
    () =>
      `Hue ${Math.round(this.hue())} degrees, Saturation ${Math.round(
        this.saturation() * 100
      )} percent, Value ${Math.round(this.value() * 100)} percent`
  );
  private pointerId: number | null = null;
  private dragRegion: 'triangle' | 'wheel' = 'triangle';
  private image: ImageData | null = null;

  constructor() {
    effect(() => {
      const canvas = this.surface()?.nativeElement;
      const mode = this.mode();
      const hue = mode === 'triangle' ? this.hue() : 0;
      const value = mode === 'wheel' ? this.value() : 1;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      const size = canvas.width;
      if (!this.image || this.image.width !== size)
        this.image = context.createImageData(size, size);
      const image = this.image;
      getColorPickerRaster(mode, size).paint(image.data, hue, value);
      context.putImageData(image, 0, 0);
    });
  }

  onAccessibleInput(event: Event, channel: 'h' | 's' | 'v'): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.selectionChange.emit({ [channel]: channel === 'h' ? value : value / 100 });
  }

  startDrag(event: PointerEvent): void {
    if (event.button !== 0 || this.pointerId !== null) return;
    const canvas = event.currentTarget as HTMLCanvasElement;
    const point = this.eventPoint(event, canvas);
    const radius = Math.hypot(point.x - 0.5, point.y - 0.5);
    if (this.mode() === 'wheel' && radius <= 0.48) this.dragRegion = 'wheel';
    else if (this.mode() === 'wheel') return;
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
      this.selectionChange.emit({ h: color.s === 0 ? this.hue() : color.h, s: color.s });
    }
  }
}
