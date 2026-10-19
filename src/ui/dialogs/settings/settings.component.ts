import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  type WritableSignal,
  signal,
  effect,
  inject,
  Injector,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { appSettings } from 'src/settings-loader';
import { AppSettingsService, type AppSettings } from '../../../services/app-settings.service';
import { PlatformFileService, IOS_DEFAULT_FOLDER } from '../../../services/platform-file.service';
import { getExportResolutions } from '../../export-settings/export-resolutions';
import themes from '../../../shared/themes.json';
import { ColorPickerComponent } from '../../canvas/color-picker/color-picker.component';

// Tool options for default tool dropdown
const AVAILABLE_TOOLS = [
  { id: 'pencil', label: 'Pencil' },
  { id: 'brush', label: 'Brush' },
  { id: 'bucket-fill', label: 'Bucket Fill' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'object-eraser', label: 'Object Eraser' },
  { id: 'select', label: 'Select' },
  { id: 'zoom', label: 'Zoom' },
];

// Theme options for user-selectable concrete themes (system is chosen separately)
const AVAILABLE_THEMES = themes
  .filter((theme) => theme.id !== 'system')
  .map((theme) => ({ id: theme.id, label: theme.label }));

const AVAILABLE_THEME_IDS = new Set(AVAILABLE_THEMES.map((theme) => theme.id));

// Export type options for the default export format dropdown
const EXPORT_FORMATS = [
  { id: 'png', label: 'PNG Sequence' },
  { id: 'video', label: 'MP4 Video' },
  { id: 'pdf', label: 'Storyboard PDF' },
];

interface SelectOption {
  id: string;
  label: string;
}

interface CheckboxFieldConfig {
  id: string;
  label: string;
  value: WritableSignal<boolean>;
  checkboxLabelClass?: string;
}

interface NumberFieldConfig {
  id: string;
  label: string;
  value: WritableSignal<number>;
  min?: number;
  max?: number;
  unit?: string;
  groupClass?: string;
  disabled?: () => boolean;
}

interface SelectFieldConfig {
  id: string;
  label: string;
  value: WritableSignal<string>;
  options: readonly SelectOption[];
  useNgModel?: boolean;
}

interface ColorFieldConfig {
  id: string;
  label: string;
  value: WritableSignal<string>;
  fieldClass?: string;
}

interface ToolProperty {
  id: string;
  label: string;
  value: WritableSignal<number>;
  min?: number;
  max?: number;
  unit?: string;
}

interface ToolFieldConfig {
  id: string;
  label: string;
  properties: readonly ToolProperty[];
}

interface SettingsSection {
  id: string;
  title: string;
  gridClass?: string;
  checkboxFields?: readonly CheckboxFieldConfig[];
  numberFields?: readonly NumberFieldConfig[];
  selectFields?: readonly SelectFieldConfig[];
  colorFields?: readonly ColorFieldConfig[];
  toolFields?: readonly ToolFieldConfig[];
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ColorPickerComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit, OnDestroy {
  private readonly appSettingsService = inject(AppSettingsService);
  private readonly platformFile = inject(PlatformFileService);
  private readonly injector = inject(Injector);
  readonly isMobile = this.platformFile.isNative;
  private readonly settingsHydrated = signal(false);
  private static readonly MS_PER_MINUTE = 60_000;
  private readonly defaultIpadDir = IOS_DEFAULT_FOLDER;

  // Helper to safely get app settings values
  private getSafeSettingValue(path: string, defaultValue: unknown = null): unknown {
    try {
      const settings = appSettings as Partial<Record<string, unknown>>;
      const keys = path.split('.');
      let current: unknown = settings;
      for (const key of keys) {
        if (typeof current === 'object' && current !== null && key in current) {
          current = (current as Record<string, unknown>)[key];
        } else {
          return defaultValue;
        }
      }
      return current ?? defaultValue;
    } catch {
      console.error(`Failed to get setting ${path}`);
      return defaultValue;
    }
  }

  // Settings states - with safe defaults
  readonly initialDir = signal<string>(
    this.platformFile.isIos
      ? this.defaultIpadDir
      : (this.getSafeSettingValue('saving.initialDir', 'documents') as string)
  );
  readonly autosave = signal<boolean>(this.getSafeSettingValue('saving.autosave', true) as boolean);
  readonly autosaveDuration = signal<number>(
    Math.round(
      ((this.getSafeSettingValue('saving.autosaveDuration', 300000) as number) || 300000) /
        SettingsComponent.MS_PER_MINUTE
    )
  );
  readonly savedToast = signal<boolean>(
    this.getSafeSettingValue('saving.savedToast', true) as boolean
  );
  readonly initialSave = signal<boolean>(
    this.getSafeSettingValue('saving.initialSave', true) as boolean
  );
  readonly exportDefaultFormat = signal<string>(
    this.getSafeSettingValue('export.defaultFormat', 'png') as string
  );
  readonly exportDefaultResolution = signal<string>(
    String(this.getSafeSettingValue('export.defaultResolutionIndex', 2) as number)
  );
  readonly defaultLaneCount = signal<number>(
    this.getSafeSettingValue('audio.defaultLaneCount', 1) as number
  );
  readonly defaultVolume = signal<number>(
    ((this.getSafeSettingValue('audio.defaultVolume', 1) as number | null | undefined) ?? 1) * 100
  );
  readonly systemLightTheme = signal<string>(
    this.getSafeSettingValue('theme.systemLightTheme', 'white') as string
  );
  readonly systemDarkTheme = signal<string>(
    this.getSafeSettingValue('theme.systemDarkTheme', 'black') as string
  );
  readonly defaultStrokeColor = signal<string>(
    this.getSafeSettingValue('canvas.defaultStrokeColor', '#000000') as string
  );
  readonly defaultFillColor = signal<string>(
    this.getSafeSettingValue('canvas.defaultFillColor', '#ffffff') as string
  );
  readonly defaultBackgroundColor = signal<string>(
    this.getSafeSettingValue('canvas.defaultBackgroundColor', '#ffffff') as string
  );
  readonly defaultTool = signal<string>(
    this.getSafeSettingValue('canvas.defaultTool', 'pencil') as string
  );
  readonly showClearCanvasWarning = signal<boolean>(
    this.getSafeSettingValue('canvas.showClearCanvasWarning', true) as boolean
  );
  readonly minZoom = signal<number>(this.getSafeSettingValue('timeline.zoom.minZoom', 2) as number);
  readonly maxZoom = signal<number>(
    this.getSafeSettingValue('timeline.zoom.maxZoom', 2500) as number
  );
  readonly defaultZoom = signal<number>(
    this.getSafeSettingValue('timeline.zoom.defaultZoom', 40) as number
  );
  readonly zoomStep = signal<number>(
    this.getSafeSettingValue('timeline.zoom.zoomStep', 100) as number
  );
  readonly boilVariations = signal<number>(
    this.getSafeSettingValue('boil.variations', 3) as number
  );
  readonly boilHoldFrames = signal<number>(
    this.getSafeSettingValue('boil.holdFrames', 2) as number
  );
  readonly boilAmount = signal<number>(this.getSafeSettingValue('boil.amount', 2.5) as number);
  readonly boilNewFrames = signal<boolean>(
    this.getSafeSettingValue('boil.boilNewFrames', false) as boolean
  );
  readonly onionFramesBack = signal<number>(
    this.getSafeSettingValue('onionSkin.framesBack', 1) as number
  );
  readonly onionFramesForward = signal<number>(
    this.getSafeSettingValue('onionSkin.framesForward', 1) as number
  );
  readonly onionPrevColor = signal<string>(
    this.getSafeSettingValue('onionSkin.prevColor', '#ff00ff') as string
  );
  readonly onionNextColor = signal<string>(
    this.getSafeSettingValue('onionSkin.nextColor', '#00b3ff') as string
  );

  // Tool default properties
  readonly pencilSize = signal<number>(this.getSafeSettingValue('tools.pencil.size', 5) as number);
  readonly brushSize = signal<number>(this.getSafeSettingValue('tools.brush.size', 5) as number);
  readonly brushSpacing = signal<number>(
    this.getSafeSettingValue('tools.brush.spacing', 45) as number
  );
  readonly eraserSize = signal<number>(this.getSafeSettingValue('tools.eraser.size', 5) as number);
  readonly rectangleSize = signal<number>(
    this.getSafeSettingValue('tools.rectangle.size', 5) as number
  );
  readonly circleSize = signal<number>(this.getSafeSettingValue('tools.circle.size', 5) as number);
  readonly polygonSize = signal<number>(
    this.getSafeSettingValue('tools.polygon.size', 5) as number
  );
  readonly bucketFillTolerance = signal<number>(
    this.getSafeSettingValue('tools.bucketFill.tolerance', 16) as number
  );

  readonly savingCheckboxFields: readonly CheckboxFieldConfig[] = [
    {
      id: 'saved-toast-checkbox',
      label: 'Save Alert',
      value: this.savedToast,
      checkboxLabelClass: 'saving-checkbox-label',
    },
    {
      id: 'initial-save-checkbox',
      label: 'Save New Projects',
      value: this.initialSave,
      checkboxLabelClass: 'saving-checkbox-label',
    },
    {
      id: 'autosave-checkbox',
      label: 'Autosave',
      value: this.autosave,
      checkboxLabelClass: 'saving-checkbox-label',
    },
  ];

  readonly savingNumberFields: readonly NumberFieldConfig[] = [
    {
      id: 'autosave-duration',
      label: 'Frequency',
      value: this.autosaveDuration,
      min: 1,
      unit: 'min',
      groupClass: 'duration-input-group',
      disabled: () => !this.autosave(),
    },
  ];

  readonly audioNumberFields: readonly NumberFieldConfig[] = [
    {
      id: 'default-lanes',
      label: 'Audio Tracks',
      value: this.defaultLaneCount,
      min: 1,
      max: 4,
    },
    {
      id: 'default-volume',
      label: 'Clip Volume',
      value: this.defaultVolume,
      min: 0,
      max: 100,
      unit: '%',
      groupClass: 'volume-input-group',
    },
  ];

  readonly themeSelectFields: readonly SelectFieldConfig[] = [
    {
      id: 'light-theme',
      label: 'System Light Theme',
      value: this.systemLightTheme,
      options: AVAILABLE_THEMES,
      useNgModel: true,
    },
    {
      id: 'dark-theme',
      label: 'System Dark Theme',
      value: this.systemDarkTheme,
      options: AVAILABLE_THEMES,
      useNgModel: true,
    },
  ];

  readonly exportSelectFields: readonly SelectFieldConfig[] = [
    {
      id: 'export-default-format',
      label: 'Export Type',
      value: this.exportDefaultFormat,
      options: EXPORT_FORMATS,
      useNgModel: true,
    },
    {
      id: 'export-default-resolution',
      label: 'Resolution',
      value: this.exportDefaultResolution,
      options: getExportResolutions().map((resolution, index) => ({
        id: String(index),
        label: resolution.label,
      })),
      useNgModel: true,
    },
  ];

  readonly canvasColorFields: readonly ColorFieldConfig[] = [
    {
      id: 'stroke-color',
      label: 'Stroke',
      value: this.defaultStrokeColor,
      fieldClass: 'compact-color-field',
    },
    {
      id: 'fill-color',
      label: 'Fill',
      value: this.defaultFillColor,
      fieldClass: 'compact-color-field',
    },
    {
      id: 'bg-color',
      label: 'BG',
      value: this.defaultBackgroundColor,
      fieldClass: 'compact-color-field',
    },
  ];

  readonly canvasSelectFields: readonly SelectFieldConfig[] = [
    {
      id: 'default-tool',
      label: 'Tool',
      value: this.defaultTool,
      options: AVAILABLE_TOOLS,
    },
  ];

  readonly canvasCheckboxFields: readonly CheckboxFieldConfig[] = [
    {
      id: 'clear-canvas-warning',
      label: 'Clear Canvas Warning',
      value: this.showClearCanvasWarning,
    },
  ];

  readonly timelineNumberFields: readonly NumberFieldConfig[] = [
    {
      id: 'min-zoom',
      label: 'minZoom',
      value: this.minZoom,
      min: 1,
    },
    {
      id: 'max-zoom',
      label: 'maxZoom',
      value: this.maxZoom,
      min: 1,
    },
    {
      id: 'default-zoom',
      label: 'defaultZoom',
      value: this.defaultZoom,
      min: 1,
    },
    {
      id: 'zoom-step',
      label: 'zoomStep',
      value: this.zoomStep,
      min: 1,
    },
  ];

  readonly boilNumberFields: readonly NumberFieldConfig[] = [
    {
      id: 'boil-variations',
      label: 'Variations',
      value: this.boilVariations,
      min: 2,
      max: 12,
    },
    {
      id: 'boil-hold-frames',
      label: 'Hold Frames',
      value: this.boilHoldFrames,
      min: 1,
      max: 24,
    },
    {
      id: 'boil-amount',
      label: 'Jitter Amount',
      value: this.boilAmount,
      min: 0,
      max: 20,
      unit: 'px',
    },
  ];

  readonly boilCheckboxFields: readonly CheckboxFieldConfig[] = [
    {
      id: 'boil-new-frames',
      label: 'Boil New Frames',
      value: this.boilNewFrames,
    },
  ];

  readonly onionNumberFields: readonly NumberFieldConfig[] = [
    {
      id: 'onion-frames-back',
      label: 'Frames Back',
      value: this.onionFramesBack,
      min: 0,
      max: 10,
    },
    {
      id: 'onion-frames-forward',
      label: 'Frames Forward',
      value: this.onionFramesForward,
      min: 0,
      max: 10,
    },
  ];

  readonly onionColorFields: readonly ColorFieldConfig[] = [
    {
      id: 'onion-prev-color',
      label: 'Previous',
      value: this.onionPrevColor,
      fieldClass: 'compact-color-field',
    },
    {
      id: 'onion-next-color',
      label: 'Next',
      value: this.onionNextColor,
      fieldClass: 'compact-color-field',
    },
  ];

  readonly toolFields: readonly ToolFieldConfig[] = [
    {
      id: 'tool-pencil',
      label: 'Pencil',
      properties: [{ id: 'pencil-size', label: 'Size', value: this.pencilSize, min: 1, max: 500 }],
    },
    {
      id: 'tool-brush',
      label: 'Brush',
      properties: [
        { id: 'brush-size', label: 'Size', value: this.brushSize, min: 1, max: 500 },
        { id: 'brush-spacing', label: 'Spacing', value: this.brushSpacing, min: 10, max: 200 },
      ],
    },
    {
      id: 'tool-eraser',
      label: 'Eraser',
      properties: [{ id: 'eraser-size', label: 'Size', value: this.eraserSize, min: 1, max: 500 }],
    },
    {
      id: 'tool-rectangle',
      label: 'Rectangle',
      properties: [
        { id: 'rectangle-size', label: 'Stroke', value: this.rectangleSize, min: 1, max: 500 },
      ],
    },
    {
      id: 'tool-circle',
      label: 'Circle',
      properties: [
        { id: 'circle-size', label: 'Stroke', value: this.circleSize, min: 1, max: 500 },
      ],
    },
    {
      id: 'tool-polygon',
      label: 'Polygon',
      properties: [
        { id: 'polygon-size', label: 'Stroke', value: this.polygonSize, min: 1, max: 500 },
      ],
    },
    {
      id: 'tool-bucket-fill',
      label: 'Bucket Fill',
      properties: [
        {
          id: 'bucket-fill-tolerance',
          label: 'Sensitivity',
          value: this.bucketFillTolerance,
          min: 0,
          max: 128,
        },
      ],
    },
  ];

  // All settings sections configuration
  readonly sections: readonly SettingsSection[] = [
    {
      id: 'saving',
      title: 'Saving',
      gridClass: 'saving-grid',
      checkboxFields: this.savingCheckboxFields,
      numberFields: this.savingNumberFields,
    },
    {
      id: 'themes',
      title: 'Themes',
      selectFields: this.themeSelectFields,
    },
    {
      id: 'export',
      title: 'Export Defaults',
      selectFields: this.exportSelectFields,
    },
    {
      id: 'audio',
      title: 'Audio Defaults',
      numberFields: this.audioNumberFields,
    },
    {
      id: 'canvas',
      title: 'Canvas Defaults',
      gridClass: 'canvas-grid',
      colorFields: this.canvasColorFields,
      selectFields: this.canvasSelectFields,
      checkboxFields: this.canvasCheckboxFields,
    },
    {
      id: 'boil',
      title: 'Line Boiling Defaults',
      numberFields: this.boilNumberFields,
      checkboxFields: this.boilCheckboxFields,
    },
    {
      id: 'onion',
      title: 'Onion Skin Defaults',
      numberFields: this.onionNumberFields,
      colorFields: this.onionColorFields,
    },
    {
      id: 'tools',
      title: 'Tool Defaults',
      gridClass: 'tools-grid',
      toolFields: this.toolFields,
    },
    {
      id: 'timeline',
      title: 'Timeline (Experimental)',
      numberFields: this.timelineNumberFields,
    },
  ];

  // UI states
  readonly showRestoreConfirm = signal(false);
  readonly saving = signal(false);
  readonly availableTools = AVAILABLE_TOOLS;
  readonly availableThemes = AVAILABLE_THEMES;

  readonly restoreConfirmTop = signal(0);
  readonly restoreConfirmRight = signal(8);

  // Collapse states for sections - stored in a Map keyed by section id
  readonly collapsedSections = signal<Set<string>>(new Set());

  readonly restartShaking = signal(false);
  readonly restartChanged = signal(false);
  private restartShakeTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSavePrimed = false;

  private triggerRestartPulse(): void {
    this.restartChanged.set(true);
    if (this.restartShakeTimer !== null) {
      clearTimeout(this.restartShakeTimer);
    }
    this.restartShaking.set(false);
    requestAnimationFrame(() => this.restartShaking.set(true));
    this.restartShakeTimer = setTimeout(() => {
      this.restartShaking.set(false);
      this.restartShakeTimer = null;
    }, 600);
  }

  private normalizeTheme(value: unknown, fallback: string): string {
    if (typeof value === 'string' && AVAILABLE_THEME_IDS.has(value)) {
      return value;
    }
    return fallback;
  }

  private readonly autoSaveEffect = effect(
    () => {
      if (!this.settingsHydrated()) {
        return;
      }

      void this.appSettingsService.saveAllSettings(this.buildSettingsPayload());

      // The first run after hydration is the initial sync on open, not a user change.
      if (!this.autoSavePrimed) {
        this.autoSavePrimed = true;
        return;
      }

      this.triggerRestartPulse();
    },
    { injector: this.injector }
  );

  ngOnInit(): void {
    void this.initializeSettings();
  }

  ngOnDestroy(): void {
    this.autoSaveEffect.destroy();
    if (this.restartShakeTimer !== null) {
      clearTimeout(this.restartShakeTimer);
    }
  }

  private async initializeSettings(): Promise<void> {
    await this.loadFreshSettings();
    this.settingsHydrated.set(true);
  }

  private buildSettingsPayload(): Partial<AppSettings> {
    const autosaveDurationMs = this.autosaveDuration() * SettingsComponent.MS_PER_MINUTE;
    return {
      // Keep legacy root fields synchronized for current consumers.
      initialDir: this.initialDir(),
      autosave: this.autosave(),
      autosaveDuration: autosaveDurationMs,
      saving: {
        initialDir: this.initialDir(),
        autosave: this.autosave(),
        autosaveDuration: autosaveDurationMs,
        savedToast: this.savedToast(),
        initialSave: this.initialSave(),
      },
      audio: {
        defaultLaneCount: this.defaultLaneCount(),
        defaultVolume: this.defaultVolume() / 100,
      },
      theme: {
        systemLightTheme: this.systemLightTheme(),
        systemDarkTheme: this.systemDarkTheme(),
      },
      canvas: {
        defaultStrokeColor: this.defaultStrokeColor(),
        defaultFillColor: this.defaultFillColor(),
        defaultBackgroundColor: this.defaultBackgroundColor(),
        defaultTool: this.defaultTool(),
        showClearCanvasWarning: this.showClearCanvasWarning(),
      },
      timeline: {
        zoom: {
          minZoom: this.minZoom(),
          maxZoom: this.maxZoom(),
          defaultZoom: this.defaultZoom(),
          zoomStep: this.zoomStep(),
        },
      },
      boil: {
        variations: this.boilVariations(),
        holdFrames: this.boilHoldFrames(),
        amount: this.boilAmount(),
        boilNewFrames: this.boilNewFrames(),
      },
      export: {
        defaultFormat: (() => {
          const v = this.exportDefaultFormat();
          return v === 'video' || v === 'pdf' ? v : 'png';
        })(),
        defaultResolutionIndex: (() => {
          const n = Number(this.exportDefaultResolution());
          const idx = Number.isFinite(n) ? Math.round(n) : 0;
          return Math.max(0, Math.min(idx, getExportResolutions().length - 1));
        })(),
      },
      onionSkin: {
        framesBack: this.onionFramesBack(),
        framesForward: this.onionFramesForward(),
        prevColor: this.onionPrevColor(),
        nextColor: this.onionNextColor(),
      },
      tools: {
        pencil: { size: this.pencilSize() },
        brush: { size: this.brushSize(), spacing: this.brushSpacing() },
        eraser: { size: this.eraserSize() },
        rectangle: { size: this.rectangleSize() },
        circle: { size: this.circleSize() },
        polygon: { size: this.polygonSize() },
        bucketFill: { tolerance: this.bucketFillTolerance() },
      },
    };
  }

  private async loadFreshSettings(): Promise<void> {
    try {
      const settings = await this.appSettingsService.loadCurrentSettings();

      // Helper to safely get nested values
      const getValue = (obj: unknown, path: string, fallback: unknown): unknown => {
        const keys = path.split('.');
        let current = obj;
        for (const key of keys) {
          if (typeof current === 'object' && current !== null && key in current) {
            current = (current as Record<string, unknown>)[key];
          } else {
            return fallback;
          }
        }
        return current ?? fallback;
      };

      const resolvedInitialDir =
        (getValue(settings, 'saving.initialDir', undefined) as string | undefined) ??
        (getValue(settings, 'initialDir', 'documents') as string);
      const initialDir =
        this.platformFile.isIos && (!resolvedInitialDir || resolvedInitialDir === 'documents')
          ? this.defaultIpadDir
          : resolvedInitialDir;
      const resolvedAutosave =
        (getValue(settings, 'saving.autosave', undefined) as boolean | undefined) ??
        (getValue(settings, 'autosave', true) as boolean);
      const resolvedAutosaveMs =
        (getValue(settings, 'saving.autosaveDuration', undefined) as number | undefined) ??
        (getValue(settings, 'autosaveDuration', 300000) as number);
      const resolvedSavedToast =
        (getValue(settings, 'saving.savedToast', undefined) as boolean | undefined) ?? true;
      const resolvedInitialSave =
        (getValue(settings, 'saving.initialSave', undefined) as boolean | undefined) ?? true;

      // Update signals with fresh values from disk
      this.initialDir.set(initialDir);
      this.autosave.set(resolvedAutosave);
      this.autosaveDuration.set(
        Math.max(1, Math.round((resolvedAutosaveMs || 300000) / SettingsComponent.MS_PER_MINUTE))
      );
      this.savedToast.set(resolvedSavedToast);
      this.initialSave.set(resolvedInitialSave);
      this.defaultLaneCount.set(getValue(settings, 'audio.defaultLaneCount', 1) as number);
      this.defaultVolume.set((getValue(settings, 'audio.defaultVolume', 1) as number) * 100);
      this.systemLightTheme.set(
        this.normalizeTheme(getValue(settings, 'theme.systemLightTheme', 'white'), 'white')
      );
      this.systemDarkTheme.set(
        this.normalizeTheme(getValue(settings, 'theme.systemDarkTheme', 'black'), 'black')
      );
      this.defaultStrokeColor.set(
        getValue(settings, 'canvas.defaultStrokeColor', '#000000') as string
      );
      this.defaultFillColor.set(getValue(settings, 'canvas.defaultFillColor', '#ffffff') as string);
      this.defaultBackgroundColor.set(
        getValue(settings, 'canvas.defaultBackgroundColor', '#ffffff') as string
      );
      const defaultTool = getValue(settings, 'canvas.defaultTool', 'pencil') as string;
      this.defaultTool.set(AVAILABLE_TOOLS.some((tool) => tool.id === defaultTool) ? defaultTool : 'pencil');
      this.showClearCanvasWarning.set(
        getValue(settings, 'canvas.showClearCanvasWarning', true) as boolean
      );
      this.minZoom.set(getValue(settings, 'timeline.zoom.minZoom', 2) as number);
      this.maxZoom.set(getValue(settings, 'timeline.zoom.maxZoom', 2500) as number);
      this.defaultZoom.set(getValue(settings, 'timeline.zoom.defaultZoom', 40) as number);
      this.zoomStep.set(getValue(settings, 'timeline.zoom.zoomStep', 100) as number);
      this.boilVariations.set(getValue(settings, 'boil.variations', 3) as number);
      this.boilHoldFrames.set(getValue(settings, 'boil.holdFrames', 2) as number);
      this.boilAmount.set(getValue(settings, 'boil.amount', 2.5) as number);
      this.boilNewFrames.set(getValue(settings, 'boil.boilNewFrames', false) as boolean);
      this.exportDefaultFormat.set(getValue(settings, 'export.defaultFormat', 'png') as string);
      this.exportDefaultResolution.set(
        String(getValue(settings, 'export.defaultResolutionIndex', 2) as number)
      );
      this.onionFramesBack.set(getValue(settings, 'onionSkin.framesBack', 1) as number);
      this.onionFramesForward.set(getValue(settings, 'onionSkin.framesForward', 1) as number);
      this.onionPrevColor.set(getValue(settings, 'onionSkin.prevColor', '#ff00ff') as string);
      this.onionNextColor.set(getValue(settings, 'onionSkin.nextColor', '#00b3ff') as string);
      this.pencilSize.set(getValue(settings, 'tools.pencil.size', 5) as number);
      this.brushSize.set(getValue(settings, 'tools.brush.size', 5) as number);
      this.brushSpacing.set(getValue(settings, 'tools.brush.spacing', 45) as number);
      this.eraserSize.set(getValue(settings, 'tools.eraser.size', 5) as number);
      this.rectangleSize.set(getValue(settings, 'tools.rectangle.size', 5) as number);
      this.circleSize.set(getValue(settings, 'tools.circle.size', 5) as number);
      this.polygonSize.set(getValue(settings, 'tools.polygon.size', 5) as number);
      this.bucketFillTolerance.set(getValue(settings, 'tools.bucketFill.tolerance', 16) as number);
    } catch (err) {
      console.error('Failed to load fresh settings:', err);
      // Fall back to default values already set in signal initialization
    }
  }

  async openBrowseDialog(): Promise<void> {
    const path = await this.platformFile.pickFolder();
    if (path) {
      this.initialDir.set(path);
    }
  }

  showRestoreConfirmDialog(event: MouseEvent): void {
    this.showRestoreConfirm.set(true);
    const target = event.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    this.restoreConfirmRight.set(Math.max(8, window.innerWidth - rect.right));
    this.restoreConfirmTop.set(Math.max(10, rect.top - 100));
  }

  async confirmRestore(): Promise<void> {
    this.showRestoreConfirm.set(false);
    this.saving.set(true);
    this.settingsHydrated.set(false);
    try {
      await this.appSettingsService.restoreDefaults();
      await this.loadFreshSettings();
    } catch (error) {
      console.error('Failed to restore defaults:', error);
    } finally {
      this.settingsHydrated.set(true);
      this.saving.set(false);
    }
  }

  cancelRestore(): void {
    this.showRestoreConfirm.set(false);
  }

  close(): void {
    // Attempt window.close() first (works for web popups even with noopener).
    // If we're in a regular browser tab or Android WebView where window.close() is a no-op,
    // it won't do anything, but we also call history.back() just in case.
    window.close();
    window.history.back();
  }

  setBooleanSignalFromInput(event: Event, targetSignal: WritableSignal<boolean>): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      targetSignal.set(input.checked);
    }
  }

  setStringSignalFromInput(event: Event, targetSignal: WritableSignal<string>): void {
    const input = event.target;
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
      targetSignal.set(input.value);
    }
  }

  setStringSignalFromModel(value: unknown, targetSignal: WritableSignal<string>): void {
    if (typeof value === 'string') {
      targetSignal.set(value);
    }
  }

  setNumberSignalFromInput(
    event: Event,
    targetSignal: WritableSignal<number>,
    min?: number,
    max?: number
  ): void {
    const input = event.target as HTMLInputElement | null;
    const rawValue = input?.valueAsNumber;
    const currentValue = targetSignal();
    const fallbackValue = Number.isFinite(currentValue)
      ? currentValue
      : typeof min === 'number'
      ? min
      : 0;

    const finiteValue =
      typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : fallbackValue;

    const clampedMin = typeof min === 'number' ? Math.max(min, finiteValue) : finiteValue;
    const clampedValue = typeof max === 'number' ? Math.min(max, clampedMin) : clampedMin;

    targetSignal.set(clampedValue);

    // Keep the visible input value synchronized with clamped/fallback output.
    if (input) {
      input.value = String(clampedValue);
    }
  }

  // Toggle collapse state for a section
  toggleSection(sectionId: string): void {
    this.collapsedSections.update((collapsed) => {
      const newSet = new Set(collapsed);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  }

  // Check if a section is collapsed
  isSectionCollapsed(sectionId: string): boolean {
    return this.collapsedSections().has(sectionId);
  }
}
