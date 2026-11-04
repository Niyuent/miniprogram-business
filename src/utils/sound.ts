/**
 * 核销/发积分成功提示音。
 *
 * 为什么不用语音播报：小程序没有 Web Speech API，`speak` 在真机静默失效。
 * 这里用打包进 dist 的 10KB 短音频（static/ding.wav），通过 InnerAudioContext 播放。
 * 任何异常（老机型、音频焦点被占、静音模式）一律吞掉 —— 声音只是锦上添花，
 * 绝不能因为它失败而打断核销主流程。
 */

type AudioCtx = ReturnType<typeof uni.createInnerAudioContext>;

let ctx: AudioCtx | null = null;
let ready = false;
let lastAt = 0;
/** 连续扫码时防止两声叠在一起，300ms 内的重复调用直接丢弃。 */
const THROTTLE_MS = 300;

function ensure(): AudioCtx | null {
  if (ctx) return ctx;
  try {
    const created = uni.createInnerAudioContext();
    created.src = '/static/ding.wav';
    created.volume = 0.9;
    created.onError(() => {
      // 设备不支持或文件缺失：标记不可用，后续不再尝试
      ready = false;
      try {
        created.destroy();
      } catch {
        /* ignore */
      }
      ctx = null;
    });
    created.onCanplay(() => {
      ready = true;
    });
    ctx = created;
    ready = true;
    return ctx;
  } catch {
    return null;
  }
}

/** 播放一声提示音；失败静默。 */
export function playDing() {
  const now = Date.now();
  if (now - lastAt < THROTTLE_MS) return;
  lastAt = now;
  const player = ensure();
  if (!player || !ready) return;
  try {
    player.stop();
    player.play();
  } catch {
    /* 静默 */
  }
}

/** 离开商家核销页时释放，避免占用音频通道。 */
export function disposeDing() {
  if (!ctx) return;
  try {
    ctx.stop();
    ctx.destroy();
  } catch {
    /* ignore */
  }
  ctx = null;
  ready = false;
}
