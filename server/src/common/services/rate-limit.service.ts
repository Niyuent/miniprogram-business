import { Injectable, Logger } from '@nestjs/common';
import { BizException, ReasonCode } from '../exceptions/biz.exception';

/**
 * 滑动窗口限流（**单实例内存版**）
 *
 * MVP 阶段够用，但有两个前提必须知道：
 *  1. **仅限单实例**。进程重启计数清零，多副本部署时每个副本各算一份
 *     （3 副本 × 3 次/小时 = 实际 9 次/小时）。要跨实例生效得换成 Redis + Lua 脚本，
 *     届时替换本类实现即可，调用方不动。
 *  2. 窗口内的计数常驻内存，靠 `sweepExpired` 惰性清理，不会无限增长。
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger('RateLimit');
  /** key → 该窗口内每次命中的时间戳 */
  private readonly buckets = new Map<string, number[]>();
  /** 清理频率：每 N 次 check 扫一遍过期桶，避免每次都遍历 */
  private checksSinceSweep = 0;

  /**
   * 记录一次访问；超限时抛 429 `RATE_LIMITED`。
   * @param key   限流维度，建议带业务前缀，如 `merchant-application:1.2.3.4`
   * @param limit 窗口内允许的次数
   * @param windowMs 窗口长度（毫秒）
   */
  check(key: string, limit: number, windowMs: number): { remaining: number } {
    const now = Date.now();
    const hits = (this.buckets.get(key) ?? []).filter((t) => now - t < windowMs);

    if (hits.length >= limit) {
      this.buckets.set(key, hits);
      const retrySec = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
      this.logger.warn(`限流命中 ${key}（${limit} 次 / ${windowMs}ms），请在 ${retrySec}s 后重试`);
      throw BizException.tooManyRequests(
        ReasonCode.RATE_LIMITED,
        `操作过于频繁，请在 ${Math.ceil(retrySec / 60)} 分钟后再试`,
      );
    }

    hits.push(now);
    this.buckets.set(key, hits);
    if (++this.checksSinceSweep >= 200) {
      this.sweepExpired(windowMs);
    }
    return { remaining: limit - hits.length };
  }

  /** 惰性清理已过期的桶；limit/window 取当前调用的参数近似即可 */
  private sweepExpired(windowMs: number) {
    this.checksSinceSweep = 0;
    const now = Date.now();
    for (const [key, hits] of this.buckets) {
      const alive = hits.filter((t) => now - t < windowMs);
      if (alive.length === 0) {
        this.buckets.delete(key);
      } else {
        this.buckets.set(key, alive);
      }
    }
  }
}
