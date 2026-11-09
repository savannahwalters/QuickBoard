import { resolveAccentBorderColor, resolveAccentColor } from './cursors';
import { getSelectionBounds } from './geometry';
import { registerRotatableShapes } from './rotatable-shapes';

export function registerImprovedSelectShapes(LC: Record<string, unknown>): void {
  if (
    !LC ||
    typeof LC['defineShape'] !== 'function' ||
    typeof LC['defineCanvasRenderer'] !== 'function'
  )
    return;

  registerRotatableShapes(LC);

  LC['defineShape']('Image', {
    constructor: function (this: Record<string, unknown>, args: Record<string, unknown>) {
      if (!args) args = {};
      this['x'] = args['x'] || 0;
      this['y'] = args['y'] || 0;
      this['scale'] = args['scale'] || 1;
      this['scaleX'] = args['scaleX'] || 1;
      this['scaleY'] = args['scaleY'] || 1;
      this['image'] = args['image'] || null;
      this['crossOrigin'] =
        (args['image'] && (args['image'] as HTMLImageElement).crossOrigin) || null;
      this['rotation'] = args['rotation'] || 0;
      this['cropX'] = args['cropX'] || 0;
      this['cropY'] = args['cropY'] || 0;
      this['cropWidth'] =
        args['cropWidth'] || (this['image'] ? (this['image'] as HTMLImageElement).width : 0);
      this['cropHeight'] =
        args['cropHeight'] || (this['image'] ? (this['image'] as HTMLImageElement).height : 0);
    },
    getBoundingRect: function (this: Record<string, unknown>) {
      if (!this['image'])
        return { x: this['x'] as number, y: this['y'] as number, width: 0, height: 0 };
      const w =
        ((this['cropWidth'] as number) || (this['image'] as HTMLImageElement).width) *
        (this['scale'] as number) *
        ((this['scaleX'] as number) || 1);
      const h =
        ((this['cropHeight'] as number) || (this['image'] as HTMLImageElement).height) *
        (this['scale'] as number) *
        ((this['scaleY'] as number) || 1);

      if (!this['rotation']) {
        return { x: this['x'] as number, y: this['y'] as number, width: w, height: h };
      }

      const cx = (this['x'] as number) + w / 2;
      const cy = (this['y'] as number) + h / 2;
      const cos = Math.cos(this['rotation'] as number);
      const sin = Math.sin(this['rotation'] as number);
      const pts = [
        { x: -w / 2, y: -h / 2 },
        { x: w / 2, y: -h / 2 },
        { x: -w / 2, y: h / 2 },
        { x: w / 2, y: h / 2 },
      ];
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of pts) {
        const lx = p.x * cos - p.y * sin + cx;
        const ly = p.x * sin + p.y * cos + cy;
        minX = Math.min(minX, lx);
        minY = Math.min(minY, ly);
        maxX = Math.max(maxX, lx);
        maxY = Math.max(maxY, ly);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    },
    toJSON: function (this: Record<string, unknown>) {
      const data: Record<string, unknown> = {
        x: this['x'],
        y: this['y'],
        imageSrc: this['image'] ? (this['image'] as HTMLImageElement).src : null,
        imageObject: this['image'],
        scale: this['scale'],
        scaleX: this['scaleX'],
        scaleY: this['scaleY'],
        rotation: this['rotation'],
        cropX: this['cropX'],
        cropY: this['cropY'],
        cropWidth: this['cropWidth'],
        cropHeight: this['cropHeight'],
      };
      if (this['crossOrigin']) data['crossOrigin'] = this['crossOrigin'];
      return data;
    },
    fromJSON: function (data: Record<string, unknown>) {
      const imageObject = data['imageObject'] as HTMLImageElement | undefined;
      let img = imageObject?.width ? imageObject : null;
      if (!img && data['imageSrc']) {
        img = new Image();
        if (data['crossOrigin']) img.crossOrigin = data['crossOrigin'] as string;
        img.src = data['imageSrc'] as string;
      }
      const LCglobal = (window as unknown as Record<string, unknown>)['LC'] as Record<
        string,
        unknown
      >;
      return (LCglobal['createShape'] as (n: string, a: Record<string, unknown>) => unknown)(
        'Image',
        {
          x: data['x'],
          y: data['y'],
          image: img,
          scale: data['scale'],
          scaleX: data['scaleX'],
          scaleY: data['scaleY'],
          rotation: data['rotation'],
          cropX: data['cropX'],
          cropY: data['cropY'],
          cropWidth: data['cropWidth'],
          cropHeight: data['cropHeight'],
        }
      );
    },
  });

  LC['defineCanvasRenderer'](
    'Image',
    function (
      ctx: CanvasRenderingContext2D,
      shape: Record<string, unknown>,
      retryCallback: () => void
    ) {
      if (shape['image'] && (shape['image'] as HTMLImageElement).width) {
        const w = (shape['cropWidth'] as number) || (shape['image'] as HTMLImageElement).width;
        const h = (shape['cropHeight'] as number) || (shape['image'] as HTMLImageElement).height;
        const sw = w * (shape['scale'] as number) * ((shape['scaleX'] as number) || 1);
        const sh = h * (shape['scale'] as number) * ((shape['scaleY'] as number) || 1);
        ctx.save();
        const cx = (shape['x'] as number) + sw / 2;
        const cy = (shape['y'] as number) + sh / 2;
        ctx.translate(cx, cy);
        if (shape['rotation']) ctx.rotate(shape['rotation'] as number);

        const cxOffset = (shape['cropX'] as number) || 0;
        const cyOffset = (shape['cropY'] as number) || 0;

        ctx.beginPath();
        ctx.rect(-sw / 2, -sh / 2, sw, sh);
        ctx.clip();

        ctx.drawImage(
          shape['image'] as HTMLImageElement,
          cxOffset,
          cyOffset,
          w,
          h,
          -sw / 2,
          -sh / 2,
          sw,
          sh
        );
        ctx.restore();
      } else if (retryCallback) {
        if (shape['image']) (shape['image'] as HTMLImageElement).onload = retryCallback;
      }
    }
  );

  LC['defineShape']('ImageSelectionOverlay', {
    constructor: function (
      this: { shape: unknown; overrideBg: string },
      args: { shape: unknown; overrideBg: string }
    ) {
      this.shape = args.shape;
      this.overrideBg = args.overrideBg;
    },
    getBoundingRect: function (this: {
      shape: { getBoundingRect: () => { x: number; y: number; width: number; height: number } };
    }) {
      return this.shape.getBoundingRect();
    },
  });

  LC['defineCanvasRenderer'](
    'ImageSelectionOverlay',
    function (ctx: CanvasRenderingContext2D, overlayShape: Record<string, unknown>) {
      const shape = overlayShape['shape'] as Record<string, unknown>;
      if (!shape || shape['className'] !== 'Image' || !shape['image']) return;

      const w =
        ((shape['cropWidth'] as number) || (shape['image'] as HTMLImageElement).width) *
        (shape['scale'] as number) *
        ((shape['scaleX'] as number) || 1);
      const h =
        ((shape['cropHeight'] as number) || (shape['image'] as HTMLImageElement).height) *
        (shape['scale'] as number) *
        ((shape['scaleY'] as number) || 1);

      ctx.save();
      ctx.translate((shape['x'] as number) + w / 2, (shape['y'] as number) + h / 2);
      if (shape['rotation']) ctx.rotate(shape['rotation'] as number);

      if (overlayShape['overrideBg']) {
        ctx.fillStyle = overlayShape['overrideBg'] as string;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      } else {
        const accent = resolveAccentColor();
        const accentBorder = resolveAccentBorderColor();

        ctx.strokeStyle = accentBorder;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.setLineDash([]);

        ctx.fillStyle = accent;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;

        const drawHandle = (x: number, y: number, isCrop = false) => {
          ctx.beginPath();
          if (isCrop) {
            ctx.fillRect(x - 6, y - 6, 12, 12);
            ctx.strokeRect(x - 6, y - 6, 12, 12);
          } else {
            ctx.arc(x, y, 7, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
          }
        };

        drawHandle(-w / 2, -h / 2);
        drawHandle(w / 2, -h / 2);
        drawHandle(-w / 2, h / 2);
        drawHandle(w / 2, h / 2);

        drawHandle(0, -h / 2, true);
        drawHandle(0, h / 2, true);
        drawHandle(-w / 2, 0, true);
        drawHandle(w / 2, 0, true);

        ctx.beginPath();
        ctx.moveTo(0, -h / 2);
        ctx.lineTo(0, -h / 2 - 25);
        ctx.stroke();
        drawHandle(0, -h / 2 - 25);
      }

      ctx.restore();
    }
  );

  LC['defineShape']('SelectionGroupOverlay', {
    constructor: function (this: Record<string, unknown>, args: Record<string, unknown>) {
      this['shapes'] = args['shapes'];
    },
    getBoundingRect: function (this: Record<string, unknown>) {
      return getSelectionBounds(this['shapes'] as Record<string, unknown>[]);
    },
  });

  LC['defineCanvasRenderer'](
    'SelectionGroupOverlay',
    function (ctx: CanvasRenderingContext2D, overlay: Record<string, unknown>) {
      const bounds = getSelectionBounds(overlay['shapes'] as Record<string, unknown>[]);
      const { x, y, width, height } = bounds;
      ctx.save();
      ctx.strokeStyle = resolveAccentBorderColor();
      ctx.fillStyle = resolveAccentColor();
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x + width / 2, y);
      ctx.lineTo(x + width / 2, y - 25);
      ctx.stroke();
      for (const [hx, hy] of [
        [x, y],
        [x + width, y],
        [x, y + height],
        [x + width, y + height],
        [x + width / 2, y - 25],
      ]) {
        ctx.beginPath();
        ctx.arc(hx, hy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  );

  LC['defineShape']('SelectionRegionOverlay', {
    constructor: function (this: Record<string, unknown>, args: Record<string, unknown>) {
      Object.assign(this, args);
    },
    getBoundingRect: function (this: Record<string, unknown>) {
      const start = this['start'] as { x: number; y: number };
      const end = this['end'] as { x: number; y: number };
      const path = this['path'] as { x: number; y: number }[];
      if ((this['mode'] === 'polygon' || this['mode'] === 'lasso') && path.length) {
        const x = Math.min(...path.map((point) => point.x));
        const y = Math.min(...path.map((point) => point.y));
        return {
          x,
          y,
          width: Math.max(...path.map((point) => point.x)) - x,
          height: Math.max(...path.map((point) => point.y)) - y,
        };
      }
      return {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };
    },
  });

  LC['defineCanvasRenderer'](
    'SelectionRegionOverlay',
    function (ctx: CanvasRenderingContext2D, shape: Record<string, unknown>) {
      const start = shape['start'] as { x: number; y: number };
      const end = shape['end'] as { x: number; y: number };
      const mode = shape['mode'] as string;
      const path = shape['path'] as { x: number; y: number }[];
      const left = Math.min(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);

      ctx.save();
      ctx.strokeStyle = resolveAccentBorderColor();
      ctx.fillStyle = resolveAccentColor();
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      if (mode === 'circle') {
        ctx.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, 2 * Math.PI);
      } else if ((mode === 'lasso' || mode === 'polygon') && path.length > 1) {
        ctx.moveTo(path[0].x, path[0].y);
        for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
      } else {
        ctx.rect(left, top, width, height);
      }

      ctx.fillStyle = 'rgba(80, 140, 255, 0.12)';
      ctx.fill();
      ctx.stroke();
      if (mode === 'polygon' && path.length) {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(path[0].x, path[0].y, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  );
}
