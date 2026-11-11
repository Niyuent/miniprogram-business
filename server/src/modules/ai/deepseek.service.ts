import { Injectable, Logger } from '@nestjs/common';

const TIMEOUT_MS = 8000;

/**
 * DeepSeek 文案（火山方舟 OpenAI 兼容接口）
 *
 * 配置与「小Z经营助手」相同：DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL。
 * 没配密钥、超时、非 2xx 都返回 null，调用方改用数字模板，不编造原因。
 */
@Injectable()
export class DeepseekService {
  private readonly logger = new Logger('Deepseek');

  configured(): boolean {
    return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  }

  async completeJson(system: string, user: string): Promise<unknown | null> {
    const key = process.env.DEEPSEEK_API_KEY?.trim();
    if (!key) return null;
    const base = (process.env.DEEPSEEK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    const model = resolveDeepseekModel();
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.warn(`DeepSeek 不可用：${(e as Error).message}`);
      throw e;
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      throw new Error(`DeepSeek HTTP ${res.status} ${text}`);
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? '';
    const json = content.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error('DeepSeek 未返回 JSON');
    return JSON.parse(json) as unknown;
  }
}

/**
 * 小Z经营助手把逻辑名 deepseek-flash 映射到火山方舟接入点 DEEPSEEK_FLASH_MODEL。
 * 直接把逻辑名传给方舟会 404 InvalidEndpointOrModel.NotFound。
 */
function resolveDeepseekModel(): string {
  const logical = (process.env.DEEPSEEK_MODEL || 'deepseek-flash').trim();
  if (logical === 'deepseek-flash' || logical === 'deepseek-v4-flash') {
    return (process.env.DEEPSEEK_FLASH_MODEL || logical).trim();
  }
  if (logical === 'deepseek-v4-pro' || logical === 'deepseek-pro') {
    return (process.env.DEEPSEEK_PRO_MODEL || logical).trim();
  }
  return logical;
}
