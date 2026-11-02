import { resolveAccentBorderColor, resolveAccentColor } from './cursors';

export function registerImprovedSelectShapes(LC: Record<string, unknown>): void {
  if (
    !LC ||
    typeof LC['defineShape'] !== 'function' ||
    typeof LC['defineCanvasRenderer'] !== 'function'
  )
    return;

  LC['defineShape']('Image', {
    constructor: function (this: Record<string, unknown>, args: Record<string, unknown>) {
      if (!args) args = {};
      this['x'] = args['x'] || 0;
      this['y'] = args['y'] || 0;
      this['scale'] = args['scale'] || 1;
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
        (this['scale'] as number);
      const h =
        ((this['cropHeight'] as number) || (this['image'] as HTMLImageElement).height) *
        (this['scale'] as number);

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
          rotation: data['rotation'],
          cropX: data['cropX'],
          cropY: data['cropY'],
          cropWidth: data['cropWidth'],
          cropHeight: data['cropHeight'],
        },
      );
    },
  });

  LC['defineCanvasRenderer'](
    'Image',
    function (
      ctx: CanvasRenderingContext2D,
      shape: Record<string, unknown>,
      retryCallback: () => void,
    ) {
      if (shape['image'] && (shape['image'] as HTMLImageElement).width) {
        const w = (shape['cropWidth'] as number) || (shape['image'] as HTMLImageElement).width;
        const h = (shape['cropHeight'] as number) || (shape['image'] as HTMLImageElement).height;
        const sw = w * (shape['scale'] as number);
        const sh = h * (shape['scale'] as number);
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
          sh,
        );
        ctx.restore();
      } else if (retryCallback) {
        if (shape['image']) (shape['image'] as HTMLImageElement).onload = retryCallback;
      }
    },
  );

  LC['defineShape']('ImageSelectionOverlay', {
    constructor: function (
      this: { shape: unknown; overrideBg: string },
      args: { shape: unknown; overrideBg: string },
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
        (shape['scale'] as number);
      const h =
        ((shape['cropHeight'] as number) || (shape['image'] as HTMLImageElement).height) *
        (shape['scale'] as number);

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
    },
  );
}
