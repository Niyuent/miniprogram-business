import { Injectable } from '@nestjs/common';
import { shanghaiDay } from '../daily-report';

/** 进程内每日轮次限额。上限读 AI_CHAT_DAILY_LIMIT（默认 30）。 */
@Injectable()
export class QuotaService {
  private readonly counters = new Map<string, number>();

  private limit(): number {
    const raw = Number(process.env.AI_CHAT_DAILY_LIMIT ?? 30);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
  }

  private key(merchantId: number): string {
    return `${merchantId}:${shanghaiDay(0).ymd.replace(/-/g, '')}`;
  }

  peek(merchantId: number): { usedToday: number; limit: number; remaining: number } {
    const limit = this.limit();
    const usedToday = this.counters.get(this.key(merchantId)) ?? 0;
    return { usedToday, limit, remaining: Math.max(0, limit - usedToday) };
  }

  /** 超限返回 false，不抛 429。 */
  tryConsume(merchantId: number): { ok: boolean; usedToday: number; limit: number } {
    const limit = this.limit();
    const key = this.key(merchantId);
    const used = this.counters.get(key) ?? 0;
    if (used >= limit) return { ok: false, usedToday: used, limit };
    const next = used + 1;
    this.counters.set(key, next);
    return { ok: true, usedToday: next, limit };
  }
}
