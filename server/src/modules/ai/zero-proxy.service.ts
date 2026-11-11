import { Injectable, Logger } from '@nestjs/common';

export interface ZeroBriefing {
  headline: string;
  advice: string;
}

/**
 * Zero（智店助手）服务端代理。
 *
 * 背景：小程序端原先直接在 config.ts 里打包 Zero 演示账号密码，包可被解包提取。
 * 现在凭证只从服务端环境变量读取（ZERO_ACCOUNT / ZERO_PASSWORD），
 * 前端只调 `/ai/zero/briefing`；Zero 不可用时返回 null，由前端走本地摘要兜底。
 */
@Injectable()
export class ZeroProxyService {
  private readonly logger = new Logger(ZeroProxyService.name);
  private readonly base = (process.env.ZERO_BASE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
  private readonly account = process.env.ZERO_ACCOUNT || '';
  private readonly password = process.env.ZERO_PASSWORD || '';
  private token = '';
  private tokenAt = 0;

  get enabled(): boolean {
    return !!this.account && !!this.password && process.env.ZERO_ENABLED !== 'false';
  }

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() - this.tokenAt < 50 * 60 * 1000) return this.token;
    const res = await fetch(`${this.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ account: this.account, password: this.password }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Zero 登录失败 HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { token?: string } };
    const token = body?.data?.token || '';
    if (!token) throw new Error('Zero 登录响应缺少 token');
    this.token = token;
    this.tokenAt = Date.now();
    return token;
  }

  /** 经营简报；任何失败都返回 null（调用方降级到本地摘要），不把 Zero 原文抛给前端。 */
  async briefing(storeName?: string): Promise<ZeroBriefing | null> {
    if (!this.enabled) return null;
    try {
      const token = await this.ensureToken();
      const res = await fetch(`${this.base}/api/briefing/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ store_name: storeName || '', store_type: 'retail', model: 'default' }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Zero 简报失败 HTTP ${res.status}`);
      const body = (await res.json()) as { data?: unknown; message?: string };
      const text = pickText(body);
      if (!text) return null;
      const lines = text
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        headline: lines[0] || text.slice(0, 80),
        advice: lines.slice(1).join(' ') || '继续关注今日核销与发积分节奏。',
      };
    } catch (error) {
      this.logger.warn(`Zero 简报不可用：${(error as Error)?.message || error}`);
      return null;
    }
  }
}

function pickText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const row = body as { detail?: unknown; message?: string; error?: string };
  if (typeof row.detail === 'string' && row.detail.trim()) return row.detail.trim();
  if (typeof row.message === 'string' && row.message.trim()) return row.message.trim();
  if (typeof row.error === 'string' && row.error.trim()) return row.error.trim();
  return '';
}
