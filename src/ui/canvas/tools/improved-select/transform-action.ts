import { LCInstance } from '../../literally-canvas-interfaces';

export class TransformAction {
  constructor(
    private readonly lc: LCInstance,
    private readonly shape: Record<string, unknown>,
    private readonly fromState: Record<string, unknown>,
    private readonly toState: Record<string, unknown>,
  ) {}

  do(): void {
    this.applyState(this.toState);
    this.lc.repaintLayer('main');
  }

  undo(): void {
    this.applyState(this.fromState);
    this.lc.repaintLayer('main');
  }

  private applyState(state: Record<string, unknown>): void {
    if (typeof this.shape['setUpperLeft'] === 'function') {
      if (state['x'] !== undefined && state['y'] !== undefined) {
        (this.shape['setUpperLeft'] as (pos: { x: number; y: number }) => void).call(this.shape, {
          x: state['x'] as number,
          y: state['y'] as number,
        });
      }
    } else {
      if (state['x'] !== undefined) this.shape['x'] = state['x'];
      if (state['y'] !== undefined) this.shape['y'] = state['y'];
    }
    if (state['scale'] !== undefined) this.shape['scale'] = state['scale'];
    if (state['scaleX'] !== undefined) this.shape['scaleX'] = state['scaleX'];
    if (state['scaleY'] !== undefined) this.shape['scaleY'] = state['scaleY'];
    if (state['width'] !== undefined) this.shape['width'] = state['width'];
    if (state['height'] !== undefined) this.shape['height'] = state['height'];
    if (state['rotation'] !== undefined) this.shape['rotation'] = state['rotation'];
    if (state['cropX'] !== undefined) this.shape['cropX'] = state['cropX'];
    if (state['cropY'] !== undefined) this.shape['cropY'] = state['cropY'];
    if (state['cropWidth'] !== undefined) this.shape['cropWidth'] = state['cropWidth'];
    if (state['cropHeight'] !== undefined) this.shape['cropHeight'] = state['cropHeight'];
  }
}
