/**
 * 亮码页屏幕亮度增强（共享）。
 * HomePanel / qrcode 页共用；页面 onHide / 面板失活时统一 restore，
 * 避免用户按 Home 键离开后亮度卡在最大。
 */

let saved: number | null = null;

export async function boostBrightness(): Promise<void> {
  try {
    const cur = await new Promise<{ value: number }>((resolve, reject) => {
      uni.getScreenBrightness({ success: resolve as (res: { value: number }) => void, fail: reject });
    });
    if (typeof cur.value === 'number') saved = cur.value;
  } catch {
    saved = null;
  }
  try {
    uni.setScreenBrightness({ value: 1 });
  } catch {
    /* H5 / 无权限时忽略 */
  }
}

export function restoreBrightness(): void {
  if (saved == null) return;
  try {
    uni.setScreenBrightness({ value: saved });
  } catch {
    /* ignore */
  }
  saved = null;
}
