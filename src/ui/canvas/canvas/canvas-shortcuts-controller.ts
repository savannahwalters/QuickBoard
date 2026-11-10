import type { CanvasComponent } from './canvas.component';
import { matchShortcut } from 'src/shared/shortcuts';

export class CanvasShortcutsController {
  constructor(private readonly canvas: CanvasComponent) {}

  handleKeyDown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    const activeE = this.canvas.document.activeElement;
    if (activeE && activeE !== this.canvas.document.body && !this.canvas.containsElement(activeE)) {
      return;
    }

    if (
      activeE instanceof HTMLInputElement ||
      activeE instanceof HTMLTextAreaElement ||
      (activeE instanceof HTMLElement && activeE.isContentEditable)
    ) {
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (this.canvas.deleteSelection()) event.preventDefault();
      return;
    }

    const shortcut = matchShortcut(event);
    if (!shortcut || shortcut.group !== 'Tools') return;
    const shift = event.shiftKey;

    switch (shortcut.id) {
      case 'select-tool':
        this.canvas.switchTools('select');
        break;
      case 'image-tool': {
        this.canvas.requestImageImport();
        break;
      }
      case 'pencil-tool':
        this.canvas.switchTools('pencil');
        break;
      case 'shape-tool':
        this.canvas.switchTools('rectangle');
        break;
      case 'eraser-tool':
        this.canvas.switchTools('eraser');
        break;
      case 'fill-tool':
        this.canvas.switchTools('bucket-fill');
        break;
      case 'next-subtool': {
        event.preventDefault();
        const tb = this.canvas.toolbar();
        if (tb?.isDrawToolActive()) {
          const option = tb.selectedDrawToolOption();
          if (option?.id === 'pencil') {
            this.canvas.switchTools('brush');
          } else {
            this.canvas.switchTools('pencil');
          }
        } else if (tb?.isEditToolActive()) {
          const options = tb.editTools;
          const currentIndex = options.findIndex(
            (option) => option.id === this.canvas.activeTool()
          );
          const next = options[(currentIndex + 1 + options.length) % options.length];
          if (next) this.canvas.switchTools(next.id);
        } else if (tb?.isShapeToolActive()) {
          const option = tb.selectedShapeTool();
          switch (option?.id) {
            case 'rectangle':
              this.canvas.switchTools('circle');
              break;
            case 'circle':
              this.canvas.switchTools('polygon');
              break;
            default:
              this.canvas.switchTools('rectangle');
          }
        } else if (tb?.isEraserToolActive()) {
          const option = tb.selectedEraserToolOption();
          if (option?.id === 'eraser') {
            this.canvas.switchTools('object-eraser');
          } else {
            this.canvas.switchTools('eraser');
          }
        }
        break;
      }
      case 'previous-subtool': {
        event.preventDefault();
        const tb = this.canvas.toolbar();
        if (tb?.isDrawToolActive()) {
          const option = tb.selectedDrawToolOption();
          if (option?.id === 'pencil') {
            this.canvas.switchTools('brush');
          } else {
            this.canvas.switchTools('pencil');
          }
        } else if (tb?.isEditToolActive()) {
          const options = tb.editTools;
          const currentIndex = options.findIndex(
            (option) => option.id === this.canvas.activeTool()
          );
          const previous = options[(currentIndex - 1 + options.length) % options.length];
          if (previous) this.canvas.switchTools(previous.id);
        } else if (tb?.isShapeToolActive()) {
          const option = tb.selectedShapeTool();
          switch (option?.id) {
            case 'rectangle':
              this.canvas.switchTools('polygon');
              break;
            case 'circle':
              this.canvas.switchTools('rectangle');
              break;
            default:
              this.canvas.switchTools('circle');
          }
        } else if (tb?.isEraserToolActive()) {
          const option = tb.selectedEraserToolOption();
          if (option?.id === 'eraser') {
            this.canvas.switchTools('object-eraser');
          } else {
            this.canvas.switchTools('eraser');
          }
        }
        break;
      }
      case 'activate-tool': {
        if (this.canvas.activeTool() === 'zoom') {
          const zoomCenter = this.canvas.lc?.canvas?.getBoundingClientRect
            ? (() => {
                const rect = this.canvas.lc!.canvas.getBoundingClientRect();
                return {
                  x: (rect as DOMRect).left + (rect as DOMRect).width / 2,
                  y: (rect as DOMRect).top + (rect as DOMRect).height / 2,
                };
              })()
            : {
                x:
                  (this.canvas.canvasContainer().nativeElement.offsetLeft as number) +
                  (this.canvas.canvasContainer().nativeElement.offsetWidth as number) / 2,
                y:
                  (this.canvas.canvasContainer().nativeElement.offsetTop as number) +
                  (this.canvas.canvasContainer().nativeElement.offsetHeight as number) / 2,
              };

          if (shift) {
            this.canvas.viewport.adjustZoomLevel(
              -(this.canvas.viewport.getClickZoomStep() as number),
              zoomCenter
            );
          } else {
            this.canvas.viewport.adjustZoomLevel(
              this.canvas.viewport.getClickZoomStep() as number,
              zoomCenter
            );
          }
        }
        break;
      }
      case 'next-tool-group': {
        event.preventDefault();
        const tb = this.canvas.toolbar();
        if (tb?.isDrawToolActive()) {
          this.canvas.switchTools(tb.selectedShapeTool()?.id as string);
        } else if (tb?.isShapeToolActive()) {
          this.canvas.switchTools(tb.selectedEraserToolOption()?.id as string);
        } else if (tb?.isEraserToolActive()) {
          this.canvas.switchTools('bucket-fill');
        } else if (tb?.isEditToolActive()) {
          this.canvas.switchTools(tb.selectedDrawToolOption()?.id as string);
        } else if (this.canvas.activeTool() === 'bucket-fill') {
          this.canvas.switchTools('zoom');
        } else if (this.canvas.activeTool() === 'zoom') {
          this.canvas.switchTools(tb?.selectedEditToolOption()?.id as string);
        }
        break;
      }
    }
  }
}
