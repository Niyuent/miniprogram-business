import UQRCode from 'uqrcodejs';

const ready = new Map<string, string>();
const queued = new Set<string>();
let line: string[] = [];
let drawing = false;
let context: UniApp.CanvasContext | null = null;

export function cachedQr(code: string): string {
  return ready.get(code) || '';
}

/** 在隐藏画布上提前画好，点击亮码时只取出图片。 */
export function prefetchQr(
  codes: string[],
  component: unknown,
  onReady: (code: string, path: string) => void,
) {
  codes.forEach((code) => {
    if (!code || ready.has(code) || queued.has(code)) return;
    queued.add(code);
    line.push(code);
  });
  drain(component, onReady);
}

export function clearQrCanvas() {
  if (drawing || !context) return;
  context.clearRect(0, 0, 220, 220);
  context.draw();
  context = null;
}

function drain(component: unknown, onReady: (code: string, path: string) => void) {
  if (drawing) return;
  const code = line.shift();
  if (!code) return;
  drawing = true;
  paint(code, component)
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
      drain(component, onReady);
    });
}

function paint(code: string, component: unknown): Promise<string> {
  return new Promise((resolve) => {
    const qr = new UQRCode();
    qr.data = code;
    qr.size = 220;
    qr.make();
    context = uni.createCanvasContext('qrCache', component as never);
    qr.canvasContext = context;
    const drawn = qr.drawCanvas() as Promise<void> | void;
    const save = () => {
      uni.canvasToTempFilePath({
        canvasId: 'qrCache',
        destWidth: 220,
        destHeight: 220,
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
