import UQRCode from 'uqrcodejs';

const ready = new Map<string, string>();
const queued = new Set<string>();
interface Job {
  code: string;
  host: unknown;
  size: number;
  canvasId: string;
}
let line: Job[] = [];
let drawing = false;
let context: UniApp.CanvasContext | null = null;
let lastSize = 220;

const DEFAULT_CANVAS_ID = 'qrCache';

export function cachedQr(code: string): string {
  return ready.get(code) || '';
}

/** 单次渲染会员码等独立二维码（不走券码预渲染队列）。 */
export function renderQrOnce(
  code: string,
  opts?: { size?: number; component?: unknown; canvasId?: string },
): Promise<string> {
  const size = opts?.size ?? 280;
  const canvasId = opts?.canvasId || DEFAULT_CANVAS_ID;
  if (isWeb()) return paintDataUrl(code, size);
  return paintUniCanvas(code, opts?.component, size, canvasId);
}

/** 进入卡包后静默预渲染；点击亮码只读缓存图片（Base64 或临时路径）。 */
export function prefetchQr(
  codes: string[],
  component: unknown,
  onReady: (code: string, path: string) => void,
  opts?: { size?: number; canvasId?: string },
) {
  const size = opts?.size ?? 220;
  const canvasId = opts?.canvasId || DEFAULT_CANVAS_ID;
  codes.forEach((code) => {
    if (!code || ready.has(code) || queued.has(code)) return;
    queued.add(code);
    line.push({ code, host: component, size, canvasId });
  });
  drain(onReady);
}

/** 清掉最近一次绘制的画布内容（页面 onHide 时调用，避免离屏 canvas 残留）。 */
export function clearQrCanvas() {
  if (drawing) return;
  if (context) {
    try {
      context.clearRect(0, 0, lastSize, lastSize);
      context.draw();
    } catch {
      /* 页面已销毁时忽略 */
    }
    context = null;
  }
}

/** 离开会员壳或退出登录时调用：停队列、清画布，释放内存。 */
export function disposeQrCache() {
  line = [];
  queued.clear();
  drawing = false;
  clearQrCanvas();
  ready.clear();
}

function isWeb() {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'web';
  } catch {
    return typeof document !== 'undefined';
  }
}

function drain(onReady: (code: string, path: string) => void) {
  if (drawing) return;
  const job = line.shift();
  if (!job) return;
  drawing = true;
  const run = isWeb() ? paintDataUrl(job.code, job.size) : paintUniCanvas(job.code, job.host, job.size, job.canvasId);
  run
    .then((path) => {
      if (path) {
        ready.set(job.code, path);
        onReady(job.code, path);
      }
    })
    .finally(() => {
      queued.delete(job.code);
      drawing = false;
      clearQrCanvas();
      drain(onReady);
    });
}

/** H5：离屏 Canvas → Base64，不依赖页面上的 canvas 节点。 */
function paintDataUrl(code: string, size = 220): Promise<string> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve('');
        return;
      }
      const shim = {
        setFillStyle(color: string) { ctx.fillStyle = color; },
        fillRect(x: number, y: number, w: number, h: number) { ctx.fillRect(x, y, w, h); },
        setGlobalAlpha(a: number) { ctx.globalAlpha = a; },
        setStrokeStyle(color: string) { ctx.strokeStyle = color; },
        beginPath() { ctx.beginPath(); },
        moveTo(x: number, y: number) { ctx.moveTo(x, y); },
        arcTo(x1: number, y1: number, x2: number, y2: number, radius = 0) { ctx.arcTo(x1, y1, x2, y2, radius); },
        closePath() { ctx.closePath(); },
        stroke() { ctx.stroke(); },
        clip() { ctx.clip(); },
        fill() { ctx.fill(); },
        drawImage(...args: unknown[]) { (ctx.drawImage as (...a: unknown[]) => void)(...args); },
        save() { ctx.save(); },
        restore() { ctx.restore(); },
        setShadow() { /* no-op */ },
        draw(_reserve?: boolean, cb?: () => void) { cb?.(); },
      };
      const qr = new UQRCode();
      qr.data = code;
      qr.size = size;
      qr.make();
      qr.canvasContext = shim as never;
      Promise.resolve(qr.drawCanvas())
        .then(() => resolve(canvas.toDataURL('image/png')))
        .catch(() => resolve(''));
    } catch {
      resolve('');
    }
  });
}

/** 小程序：隐藏 canvas 画完后导出临时文件，展示仍用 image。 */
function paintUniCanvas(
  code: string,
  component: unknown,
  size = 220,
  canvasId = DEFAULT_CANVAS_ID,
): Promise<string> {
  return new Promise((resolve) => {
    if (!component) {
      resolve('');
      return;
    }
    try {
      const qr = new UQRCode();
      qr.data = code;
      qr.size = size;
      qr.make();
      context = uni.createCanvasContext(canvasId, component as never);
      lastSize = size;
      qr.canvasContext = context;
      const drawn = qr.drawCanvas() as Promise<void> | void;
      const save = () => {
        uni.canvasToTempFilePath(
          {
            canvasId,
            destWidth: size,
            destHeight: size,
            success(res) { resolve(res.tempFilePath); },
            fail() { resolve(''); },
          },
          component as never,
        );
      };
      if (drawn && typeof (drawn as Promise<void>).then === 'function') {
        (drawn as Promise<void>).then(save).catch(() => resolve(''));
      } else {
        setTimeout(save, 40);
      }
    } catch {
      resolve('');
    }
  });
}
