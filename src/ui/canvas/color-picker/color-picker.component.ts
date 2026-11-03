import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  CircularColorSelectorComponent,
  SelectorChange,
} from './circular-color-selector.component';
import { hsvToRgb } from './color-picker-geometry';

type PickerMode = 'square' | 'triangle' | 'wheel' | 'sliders';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Hsv {
  h: number;
  s: number;
  v: number;
}

const HUE_COLORS = '#ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000';
let colorPickerId = 0;

@Component({
  selector: 'app-color-picker',
  imports: [CircularColorSelectorComponent],
  templateUrl: './color-picker.component.html',
  styleUrls: ['./color-picker.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'color-picker-host',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown)': 'onDocumentKeydown($event)',
    '(window:resize)': 'onWindowResize()',
  },
})
export class ColorPickerComponent {
  readonly label = input.required<string>();
  readonly color = input.required<string>();
  readonly colorChange = output<string>();

  readonly isOpen = signal(false);
  readonly mode = signal<PickerMode>('triangle');
  readonly modes: { id: PickerMode; name: string }[] = [
    { id: 'square', name: 'Square' },
    { id: 'triangle', name: 'Triangle' },
    { id: 'wheel', name: 'Wheel' },
    { id: 'sliders', name: 'Sliders' },
  ];
  readonly panelLeft = signal(8);
  readonly panelTop = signal(8);
  readonly hue = signal(0);
  readonly saturation = signal(1);
  readonly value = signal(1);
  readonly alpha = signal(1);
  readonly hexDraft = signal<string | null>(null);
  private ignoreNextColorSync = false;

  readonly hueId = `color-picker-hue-${++colorPickerId}`;
  readonly alphaId = `color-picker-alpha-${colorPickerId}`;
  readonly hexId = `color-picker-hex-${colorPickerId}`;
  readonly panelId = `color-picker-panel-${colorPickerId}`;
  readonly saturationId = `color-picker-saturation-${colorPickerId}`;
  readonly valueId = `color-picker-value-${colorPickerId}`;
  readonly modePanelId = `color-picker-mode-${colorPickerId}`;

  readonly svArea = viewChild<ElementRef<HTMLElement>>('svArea');
  readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  private readonly isDragging = signal(false);
  private readonly activePointerId = signal<number | null>(null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly channelGradientDirection = computed(() =>
    this.mode() === 'sliders' ? 'to top' : 'to right'
  );
  readonly hueGradient = computed(
    () => `linear-gradient(${this.channelGradientDirection()}, ${HUE_COLORS})`
  );
  readonly svBackground = computed(() => {
    const hueColor = `hsl(${Math.round(this.hue())}, 100%, 50%)`;
    return `linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, #000000 100%), linear-gradient(to right, #ffffff 0%, ${hueColor} 100%)`;
  });

  readonly displayColor = computed(() => {
    const rgb = hsvToRgb(this.hue(), this.saturation(), this.value());
    return formatRgba(rgb, this.alpha());
  });

  readonly alphaGradient = computed(() => {
    const rgb = hsvToRgb(this.hue(), this.saturation(), this.value());
    return `linear-gradient(to right, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0), rgb(${rgb.r}, ${rgb.g}, ${rgb.b}))`;
  });
  readonly saturationGradient = computed(() => {
    const start = rgbToHex(hsvToRgb(this.hue(), 0, this.value()));
    const end = rgbToHex(hsvToRgb(this.hue(), 1, this.value()));
    return `linear-gradient(${this.channelGradientDirection()}, ${start}, ${end})`;
  });
  readonly valueGradient = computed(
    () =>
      `linear-gradient(${this.channelGradientDirection()}, #000000, ${rgbToHex(
        hsvToRgb(this.hue(), this.saturation(), 1)
      )})`
  );
  readonly hexValue = computed(() => {
    const rgb = hsvToRgb(this.hue(), this.saturation(), this.value());
    return rgbToHex(rgb);
  });

  readonly alphaPercentValue = computed(() => Math.round(this.alpha() * 100));
  readonly isTransparent = computed(() => this.alpha() <= 0);
  readonly saturationPercentValue = computed(() => Math.round(this.saturation() * 100));
  readonly brightnessPercentValue = computed(() => Math.round(this.value() * 100));
  readonly valueHandlePercent = computed(() => {
    return (1 - this.value()) * 100;
  });
  readonly svValueText = computed(() => {
    return `Saturation ${this.saturationPercentValue()} percent, Brightness ${this.brightnessPercentValue()} percent`;
  });

  constructor() {
    afterRenderEffect(() => {
      const panel = this.panel();
      const open = this.isOpen();
      this.mode();
      if (panel && open) untracked(() => this.updatePanelPosition());
    });

    effect((onCleanup) => {
      if (!this.isOpen()) {
        this.hexDraft.set(null);
        return;
      }
      const document = this.host.nativeElement.ownerDocument;
      const onScroll = (event: Event) => {
        const target = event.target as Node | null;
        if (!target?.contains(this.host.nativeElement)) return;
        this.isOpen.set(false);
        this.isDragging.set(false);
        this.activePointerId.set(null);
      };
      document.addEventListener('scroll', onScroll, true);
      onCleanup(() => document.removeEventListener('scroll', onScroll, true));
    });

    effect(() => {
      const incoming = this.color();
      if (this.ignoreNextColorSync) {
        this.ignoreNextColorSync = false;
        return;
      }
      const parsed = parseColor(incoming);
      if (!parsed) return;
      const hsv = rgbToHsv(parsed);
      const currentHue = untracked(() => this.hue());
      const currentSaturation = untracked(() => this.saturation());
      const isGray = hsv.s === 0;
      const isBlack = hsv.v === 0;
      const nextHue = isGray ? currentHue : hsv.h;
      const nextSaturation = isBlack ? currentSaturation : hsv.s;
      this.hue.set(nextHue);
      this.saturation.set(nextSaturation);
      this.value.set(hsv.v);
      this.alpha.set(parsed.a);
    });
  }

  toggleOpen(): void {
    this.isOpen.set(!this.isOpen());
  }

  onWindowResize(): void {
    if (this.isOpen()) this.updatePanelPosition();
  }

  private updatePanelPosition(): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;
    const trigger = this.host.nativeElement;
    const rect = trigger.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const panelWidth = Math.min(bounds.width, Math.max(0, window.innerWidth - 16));
    const panelHeight = Math.min(bounds.height, Math.max(0, window.innerHeight - 16));
    this.panelLeft.set(
      clamp(rect.right - panelWidth, 8, Math.max(8, window.innerWidth - panelWidth - 8))
    );
    const below = rect.bottom + 6;
    const top = below + panelHeight <= window.innerHeight - 8 ? below : rect.top - panelHeight - 6;
    this.panelTop.set(clamp(top, 8, Math.max(8, window.innerHeight - panelHeight - 8)));
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (!this.host.nativeElement.contains(target)) {
      this.isOpen.set(false);
      this.isDragging.set(false);
      this.activePointerId.set(null);
    }
  }

  selectMode(mode: PickerMode): void {
    this.isDragging.set(false);
    this.activePointerId.set(null);
    this.hexDraft.set(null);
    this.mode.set(mode);
  }

  onHexInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.hexDraft.set(text);
    const digits = text.trim().replace(/^#/, '');
    if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(digits)) return;
    const parsed = parseColor(`#${digits}`);
    if (!parsed) return;
    const hsv = rgbToHsv(parsed);
    if (hsv.s !== 0) this.hue.set(hsv.h);
    if (hsv.v !== 0) this.saturation.set(hsv.s);
    this.value.set(hsv.v);
    if (digits.length === 8) this.alpha.set(parsed.a);
    this.emitColor();
  }

  onTabKeydown(event: KeyboardEvent, index: number): void {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % this.modes.length;
    else if (event.key === 'ArrowLeft') next = (index + this.modes.length - 1) % this.modes.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = this.modes.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    this.selectMode(this.modes[next].id);
    this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  onSelectionChange(change: SelectorChange): void {
    if (change.h !== undefined) this.hue.set(change.h);
    if (change.s !== undefined) this.saturation.set(change.s);
    if (change.v !== undefined) this.value.set(change.v);
    this.emitColor();
  }

  onChannelInput(event: Event, channel: 's' | 'v'): void {
    const target = event.target as HTMLInputElement;
    this.onSelectionChange({ [channel]: clamp01(target.valueAsNumber / 100) });
  }

  onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.isOpen()) return;
    if (event.key === 'Escape') {
      this.isOpen.set(false);
      this.isDragging.set(false);
      this.activePointerId.set(null);
      this.host.nativeElement.querySelector<HTMLButtonElement>('.color-trigger')?.focus();
      event.stopPropagation();
    }
  }

  startSvDrag(event: PointerEvent): void {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    target.setPointerCapture(event.pointerId);
    this.isDragging.set(true);
    this.activePointerId.set(event.pointerId);
    this.updateSvFromEvent(event);
  }

  onSvPointerMove(event: PointerEvent): void {
    if (!this.isDragging()) return;
    if (this.activePointerId() !== event.pointerId) return;
    this.updateSvFromEvent(event);
  }

  endSvDrag(event: PointerEvent): void {
    if (this.activePointerId() !== event.pointerId) return;
    this.isDragging.set(false);
    this.activePointerId.set(null);
  }

  onSvKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 0.1 : 0.02;
    let s = this.saturation();
    let v = this.value();

    if (event.key === 'ArrowLeft') s -= step;
    if (event.key === 'ArrowRight') s += step;
    if (event.key === 'ArrowUp') v += step;
    if (event.key === 'ArrowDown') v -= step;

    if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown'
    ) {
      event.preventDefault();
      this.saturation.set(clamp01(s));
      this.value.set(clamp01(v));
      this.emitColor();
    }
  }

  onHueInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    this.hue.set(clamp(target.valueAsNumber, 0, 360));
    this.emitColor();
  }

  onAlphaInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    this.alpha.set(clamp(target.valueAsNumber / 100, 0, 1));
    this.emitColor();
  }

  private updateSvFromEvent(event: PointerEvent): void {
    const areaRef = this.svArea();
    if (!areaRef) return;
    const area = areaRef.nativeElement;
    const rect = area.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    this.saturation.set(x);
    this.value.set(1 - y);
    this.emitColor();
  }

  private emitColor(): void {
    const rgb = hsvToRgb(this.hue(), this.saturation(), this.value());
    const colorValue = formatRgba(rgb, this.alpha());
    this.ignoreNextColorSync = true;
    this.colorChange.emit(colorValue);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function parseColor(value: string): Rgba | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const hexMatch = /^#([0-9a-f]{3,8})$/i.exec(normalized);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b, a: 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
  }

  const rgbMatch = /^rgba?\((.+)\)$/i.exec(normalized);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((part) => part.trim());
    if (parts.length < 3) return null;
    const r = parseRgbChannel(parts[0]);
    const g = parseRgbChannel(parts[1]);
    const b = parseRgbChannel(parts[2]);
    const a = parts.length > 3 ? parseAlphaChannel(parts[3]) : 1;
    return { r, g, b, a };
  }

  return null;
}

function parseRgbChannel(value: string): number {
  if (value.endsWith('%')) {
    const percent = parseFloat(value);
    return clamp(Math.round((percent / 100) * 255), 0, 255);
  }
  return clamp(Math.round(parseFloat(value)), 0, 255);
}

function parseAlphaChannel(value: string): number {
  if (value.endsWith('%')) {
    return clamp(parseFloat(value) / 100, 0, 1);
  }
  return clamp(parseFloat(value), 0, 1);
}

function rgbToHsv(rgba: Rgba): Hsv {
  const r = rgba.r / 255;
  const g = rgba.g / 255;
  const b = rgba.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

function formatRgba(rgb: { r: number; g: number; b: number }, alpha: number): string {
  const a = clamp01(alpha);
  if (a <= 0) return 'transparent';
  const roundedAlpha = Math.round(a * 1000) / 1000;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${roundedAlpha})`;
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`.toUpperCase();
}
