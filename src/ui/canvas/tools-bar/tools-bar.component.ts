import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

type ToolGroupKey = 'draw' | 'shape' | 'erase' | 'edit';

type ToolOption = Readonly<{
  id: string;
  label: string;
  icon: string;
  iconPath?: string;
  iconPathLength?: number;
}>;

@Component({
  selector: 'app-tools-bar',
  imports: [NgTemplateOutlet],
  templateUrl: './tools-bar.component.html',
  styleUrls: ['./tools-bar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolsBarComponent implements OnDestroy {
  readonly activeTool = input.required<string>();
  readonly isCanvasFullscreen = input(false);

  readonly toolSelected = output<string>();
  readonly imageSelected = output<File>();
  readonly clearCanvasRequested = output<void>();
  readonly canvasFullscreenToggled = output<void>();

  readonly tools: readonly ToolOption[] = [{ id: 'bucket-fill', label: 'Bucket Fill', icon: '🪣' }];
  readonly drawTools: readonly ToolOption[] = [
    { id: 'pencil', label: 'Pencil', icon: '✏️' },
    { id: 'brush', label: 'Brush', icon: '🖌️' },
  ];
  readonly shapeTools: readonly ToolOption[] = [
    { id: 'rectangle', label: 'Rectangle', icon: '⬜' },
    { id: 'circle', label: 'Circle', icon: '⚪' },
    { id: 'polygon', label: 'Polygon', icon: '📐' },
  ];
  readonly eraseTools: readonly ToolOption[] = [
    { id: 'eraser', label: 'Eraser', icon: '🧽' },
    { id: 'object-eraser', label: 'Object Eraser', icon: '🧹' },
  ];
  readonly editTools: readonly ToolOption[] = [
    {
      id: 'rectangle-select',
      label: 'Rectangle Select',
      icon: '',
      iconPath: 'M4 4H20V20H4Z',
      iconPathLength: 64,
    },
    {
      id: 'circle-select',
      label: 'Circle Select',
      icon: '',
      iconPath: 'M12 3A9 9 0 1 1 12 21A9 9 0 1 1 12 3Z',
      iconPathLength: 60,
    },
    {
      id: 'polygon-select',
      label: 'Polygon Select',
      icon: '',
      iconPath: 'M3 9L8 6L11 10L18 3L22 16L12 21L8 15L3 16Z',
    },
    {
      id: 'lasso-select',
      label: 'Lasso Select',
      icon: '',
      iconPath:
        'M7 16C4 15 3 12 4 9C6 6 9 6 12 4C16 1 21 4 21 8C22 13 17 16 10 16C8 16 7 15 7 16C7 20 9 23 11 21',
    },
  ];

  readonly selectedDrawTool = signal<'pencil' | 'brush'>('pencil');
  readonly selectedShape = signal<'rectangle' | 'circle' | 'polygon'>('rectangle');
  readonly selectedEraserTool = signal<'eraser' | 'object-eraser'>('eraser');
  readonly selectedEditTool = signal<
    'rectangle-select' | 'circle-select' | 'polygon-select' | 'lasso-select'
  >('rectangle-select');
  readonly openToolSubmenu = signal<ToolGroupKey | null>(null);
  readonly toolSubmenuTop = signal(0);

  readonly activeSubmenuTools = computed(() => {
    const group = this.openToolSubmenu();
    if (group === 'draw') return this.drawTools;
    if (group === 'shape') return this.shapeTools;
    if (group === 'erase') return this.eraseTools;
    if (group === 'edit') return this.editTools;
    return [] as readonly ToolOption[];
  });
  readonly activeSubmenuLabel = computed(() => {
    const group = this.openToolSubmenu();
    if (group === 'draw') return 'Draw tools';
    if (group === 'shape') return 'Shape tools';
    if (group === 'erase') return 'Eraser tools';
    if (group === 'edit') return 'Selection tools';
    return '';
  });
  readonly activeSubmenuSelectedId = computed(() => {
    const group = this.openToolSubmenu();
    if (group === 'draw') return this.selectedDrawTool();
    if (group === 'shape') return this.selectedShape();
    if (group === 'erase') return this.selectedEraserTool();
    if (group === 'edit') return this.selectedEditTool();
    return '';
  });
  readonly isDrawToolActive = computed(() => this.isDrawTool(this.activeTool()));
  readonly isEraserToolActive = computed(() => this.isEraserTool(this.activeTool()));
  readonly isShapeToolActive = computed(() => this.isShapeTool(this.activeTool()));
  readonly isEditToolActive = computed(() => this.isEditTool(this.activeTool()));
  readonly selectedDrawToolOption = computed(() => {
    const current = this.selectedDrawTool();
    return this.drawTools.find((tool) => tool.id === current) ?? this.drawTools[0];
  });
  readonly selectedShapeTool = computed(() => {
    const current = this.selectedShape();
    return this.shapeTools.find((tool) => tool.id === current) ?? this.shapeTools[0];
  });
  readonly selectedEraserToolOption = computed(() => {
    const current = this.selectedEraserTool();
    return this.eraseTools.find((tool) => tool.id === current) ?? this.eraseTools[0];
  });
  readonly selectedEditToolOption = computed(() => {
    const current = this.selectedEditTool();
    return this.editTools.find((tool) => tool.id === current) ?? this.editTools[0];
  });

  readonly tooltipText = signal('');
  readonly tooltipVisible = signal(false);
  readonly tooltipTop = signal(0);
  readonly tooltipLeft = signal(0);

  private readonly document = inject(DOCUMENT);
  private tooltipDelay: number | null = null;
  private tooltipCooldown: number | null = null;
  private tooltipWarm = false;
  private toolGroupHoldTimer: number | null = null;
  private activePointerGroup: ToolGroupKey | null = null;
  private groupHoldTriggered = false;

  constructor() {
    effect(() => {
      const toolId = this.activeTool();

      if (this.isDrawTool(toolId)) {
        this.selectedDrawTool.set(toolId);
      }

      if (this.isShapeTool(toolId)) {
        this.selectedShape.set(toolId);
      }

      if (this.isEraserTool(toolId)) {
        this.selectedEraserTool.set(toolId);
      }

      if (this.isEditTool(toolId)) {
        this.selectedEditTool.set(toolId);
      }
    });

    effect((onCleanup) => {
      const handlePointerDown = (event: PointerEvent) => this.handleDocumentPointerDown(event);
      this.document.addEventListener('pointerdown', handlePointerDown, true);
      onCleanup(() => {
        this.document.removeEventListener('pointerdown', handlePointerDown, true);
      });
    });
  }

  ngOnDestroy(): void {
    this.clearTimer('tooltipDelay');
    this.clearTimer('tooltipCooldown');
    this.clearToolGroupHoldTimer();
  }

  public onToolGroupPointerDown(event: PointerEvent, group: ToolGroupKey): void {
    if (event.button !== 0) {
      return;
    }

    this.hideTooltip();
    this.closeToolSubmenu();
    this.activePointerGroup = group;
    this.groupHoldTriggered = false;

    const button = event.currentTarget as HTMLElement | null;
    if (button) {
      this.toolSubmenuTop.set(button.offsetTop);
    }

    this.clearToolGroupHoldTimer();
    this.toolGroupHoldTimer = window.setTimeout(() => {
      if (this.activePointerGroup !== group) {
        return;
      }

      this.groupHoldTriggered = true;
      this.openToolSubmenu.set(group);
    }, 300);
  }

  public onToolGroupContextMenu(event: MouseEvent, group: ToolGroupKey): void {
    event.preventDefault();

    this.hideTooltip();
    this.closeToolSubmenu();

    const button = event.currentTarget as HTMLElement | null;
    if (button) {
      this.toolSubmenuTop.set(button.offsetTop);
    }

    this.openToolSubmenu.set(group);
  }

  public onToolGroupPointerUp(group: ToolGroupKey): void {
    if (this.activePointerGroup !== group) {
      return;
    }

    this.activePointerGroup = null;
    const wasHold = this.groupHoldTriggered;
    this.clearToolGroupHoldTimer();
    this.groupHoldTriggered = false;

    if (wasHold) {
      return;
    }

    this.closeToolSubmenu();
    this.toolSelected.emit(this.getSelectedToolForGroup(group));
  }

  public onToolGroupPointerCancel(group: ToolGroupKey): void {
    if (this.activePointerGroup !== group) {
      return;
    }

    this.activePointerGroup = null;
    this.groupHoldTriggered = false;
    this.clearToolGroupHoldTimer();
  }

  public onToolGroupClick(group: ToolGroupKey): void {
    // If a submenu is open, don't interfere—this click is the end of a press-and-hold interaction.
    // The user will click on a submenu item, not the button again.
    if (this.openToolSubmenu()) {
      return;
    }

    this.hideTooltip();
    this.toolSelected.emit(this.getSelectedToolForGroup(group));
  }

  public onObjectSelectClick(): void {
    this.hideTooltip();
    this.closeToolSubmenu();
    this.toolSelected.emit('select');
  }

  public onActiveSubmenuSelect(toolId: string): void {
    const group = this.openToolSubmenu();
    if (!group) {
      return;
    }

    if (group === 'draw' && this.isDrawTool(toolId)) {
      this.selectedDrawTool.set(toolId);
      this.closeToolSubmenu();
      this.toolSelected.emit(toolId);
      return;
    }

    if (group === 'shape' && this.isShapeTool(toolId)) {
      this.selectedShape.set(toolId);
      this.closeToolSubmenu();
      this.toolSelected.emit(toolId);
      return;
    }

    if (group === 'erase' && this.isEraserTool(toolId)) {
      this.selectedEraserTool.set(toolId);
      this.closeToolSubmenu();
      this.toolSelected.emit(toolId);
      return;
    }

    if (group === 'edit' && this.isEditTool(toolId)) {
      this.selectedEditTool.set(toolId);
      this.closeToolSubmenu();
      this.toolSelected.emit(toolId);
    }
  }

  public requestClearCanvas(): void {
    this.hideTooltip();
    this.clearCanvasRequested.emit();
  }

  public requestImageImport(): void {
    const input = this.document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.style.opacity = '0';
    const cleanup = () => input.remove();
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        cleanup();
        if (file) this.imageSelected.emit(file);
      },
      { once: true }
    );
    input.addEventListener('cancel', cleanup, { once: true });
    this.document.body.appendChild(input);
    input.click();
  }

  public toggleCanvasFullscreen(): void {
    this.hideTooltip();
    this.canvasFullscreenToggled.emit();
  }

  public showTooltip(event: MouseEvent, label: string): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.tooltipText.set(label);
    this.tooltipTop.set(rect.top + rect.height / 2);
    this.tooltipLeft.set(rect.right + 8);
    this.clearTimer('tooltipCooldown');

    if (this.tooltipWarm) {
      this.tooltipVisible.set(true);
    } else {
      this.tooltipDelay = window.setTimeout(() => {
        this.tooltipVisible.set(true);
        this.tooltipWarm = true;
        this.tooltipDelay = null;
      }, 500);
    }
  }

  public hideTooltip(): void {
    this.clearTimer('tooltipDelay');
    this.tooltipVisible.set(false);
    this.tooltipCooldown = window.setTimeout(() => {
      this.tooltipWarm = false;
      this.tooltipCooldown = null;
    }, 400);
  }

  private clearTimer(key: 'tooltipDelay' | 'tooltipCooldown'): void {
    if (this[key] !== null) {
      clearTimeout(this[key]!);
      this[key] = null;
    }
  }

  private handleDocumentPointerDown(event: PointerEvent): void {
    if (!this.openToolSubmenu()) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.closest('.tool-group-button') || target.closest('.tool-group-submenu')) {
      return;
    }

    this.closeToolSubmenu();
  }

  private isDrawTool(toolId: string): toolId is 'pencil' | 'brush' {
    return toolId === 'pencil' || toolId === 'brush';
  }

  private isEraserTool(toolId: string): toolId is 'eraser' | 'object-eraser' {
    return toolId === 'eraser' || toolId === 'object-eraser';
  }

  private isShapeTool(toolId: string): toolId is 'rectangle' | 'circle' | 'polygon' {
    return toolId === 'rectangle' || toolId === 'circle' || toolId === 'polygon';
  }

  private isEditTool(
    toolId: string
  ): toolId is 'rectangle-select' | 'circle-select' | 'polygon-select' | 'lasso-select' {
    return (
      toolId === 'rectangle-select' ||
      toolId === 'circle-select' ||
      toolId === 'polygon-select' ||
      toolId === 'lasso-select'
    );
  }

  private getSelectedToolForGroup(group: ToolGroupKey): string {
    if (group === 'draw') {
      return this.selectedDrawTool();
    }

    if (group === 'shape') {
      return this.selectedShape();
    }

    if (group === 'erase') {
      return this.selectedEraserTool();
    }

    return this.selectedEditTool();
  }

  private closeToolSubmenu(): void {
    this.openToolSubmenu.set(null);
    this.hideTooltip();
  }

  private clearToolGroupHoldTimer(): void {
    if (this.toolGroupHoldTimer !== null) {
      clearTimeout(this.toolGroupHoldTimer);
      this.toolGroupHoldTimer = null;
    }
  }
}
