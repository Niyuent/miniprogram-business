import UQRCode from 'uqrcodejs';

const ready = new Map<string, string>();
const queued = new Set<string>();
let line: string[] = [];
let drawing = false;
let context: UniApp.CanvasContext | null = null;
let host: unknown = null;

export function cachedQr(code: string): string {
  return ready.get(code) || '';
}

/** 单次渲染会员码等独立二维码（不走券码预渲染队列）。 */
export function renderQrOnce(
  code: string,
  opts?: { size?: number; component?: unknown },
): Promise<string> {
  const size = opts?.size ?? 280;
  if (isWeb()) return paintDataUrl(code, size);
  return paintUniCanvas(code, opts?.component, size);
}

/** 进入卡包后静默预渲染；点击亮码只读缓存图片（Base64 或临时路径）。 */
export function prefetchQr(
  codes: string[],
  component: unknown,
  onReady: (code: string, path: string) => void,
) {
  if (component) host = component;
  codes.forEach((code) => {
    if (!code || ready.has(code) || queued.has(code)) return;
    queued.add(code);
    line.push(code);
  });
  drain(onReady);
}

export function clearQrCanvas() {
  if (drawing) return;
  if (context) {
    try {
      context.clearRect(0, 0, 220, 220);
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
  host = null;
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
  const code = line.shift();
  if (!code) return;
  drawing = true;
  const job = isWeb() ? paintDataUrl(code) : paintUniCanvas(code, host);
  job
    .then((path) => {
      if (path) {
        ready.set(code, path);
        onReady(code, path);
      }
    })
    .finally(() => {
      queued.delete(code);
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
        arcTo(x1: number, y1: number, x2: number, y2: number, r: number) { ctx.arcTo(x1, y1, x2, y2, r); },
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
function paintUniCanvas(code: string, component: unknown, size = 220): Promise<string> {
  return new Promise((resolve) => {
    if (!component) {
      resolve('');
      return;
    }
    const qr = new UQRCode();
    qr.data = code;
    qr.size = size;
    qr.make();
    context = uni.createCanvasContext('qrCache', component as never);
    qr.canvasContext = context;
    const drawn = qr.drawCanvas() as Promise<void> | void;
    const save = () => {
      uni.canvasToTempFilePath({
        canvasId: 'qrCache',
        destWidth: size,
        destHeight: size,
        success(res) { resolve(res.tempFilePath); },
        fail() { resolve(''); },
      }, component as never);
    };
    if (drawn && typeof (drawn as Promise<void>).then === 'function') {
      (drawn as Promise<void>).then(save).catch(() => resolve(''));
    } else {
      setTimeout(save, 40);
    }
  });
}
