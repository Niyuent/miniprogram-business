import { Injectable, Logger } from '@nestjs/common';

/** 业务侧约定的稳定返回。Laya 原响应是按问题 id 分组的对象，这里摊平。 */
export interface LayaAnswer {
  question: string;
  label: string;
  probability: number;
  confidence: number;
}

export interface LayaDecision {
  answers: LayaAnswer[];
  raw: unknown;
}

const TIMEOUT_MS = 3000;

/**
 * Laya 决策服务（AI-1）
 *
 * 当前镜像 `bmw8080/laya-decision-api` 只暴露 `POST /v1/decide`
 * （OpenAPI 无 `/v1/systemone`，契约与文档里的 systemone 相同）。它只做 choice / score，不生成句子。
 * 超时 3 秒；连不上、非 2xx、返回无法解析时抛错，由调用方降级，不往上冒成 500。
 */
@Injectable()
export class LayaService {
  private readonly logger = new Logger('Laya');

  baseUrl(): string {
    return (process.env.LAYA_SERVICE_URL || 'http://laya:8765').replace(/\/$/, '');
  }

  async decide(state: unknown, questions: Record<string, unknown>): Promise<LayaDecision> {
    const url = `${this.baseUrl()}/v1/decide`;
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          questions,
          policy: { timeout_ms: TIMEOUT_MS, return_probabilities: true },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.warn(`Laya 不可用（${Date.now() - started}ms）：${(e as Error).message}`);
      throw e;
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      throw new Error(`Laya HTTP ${res.status} ${text}`);
    }
    const raw = (await res.json()) as { answers?: unknown };
    return { answers: normalizeAnswers(raw.answers), raw };
  }
}

function normalizeAnswers(answers: unknown): LayaAnswer[] {
  if (!answers || typeof answers !== 'object') return [];
  if (Array.isArray(answers)) {
    return answers.map((item, i) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        question: String(row.question ?? row.id ?? i),
        label: String(row.label ?? row.choice ?? ''),
        probability: num(row.probability),
        confidence: num(row.confidence),
      };
    });
  }
  return Object.entries(answers as Record<string, unknown>).map(([question, value]) => {
    const row = (value ?? {}) as Record<string, unknown>;
    const label = String(row.choice ?? row.label ?? legendLabel(row) ?? '');
    const probabilities = (row.probabilities ?? {}) as Record<string, unknown>;
    const probability = label && probabilities[label] != null ? num(probabilities[label]) : num(row.score ?? row.probability);
    return { question, label, probability, confidence: num(row.confidence) };
  });
}

function legendLabel(row: Record<string, unknown>): string | undefined {
  const legend = row.legend as Record<string, unknown> | undefined;
  if (!legend || row.score == null) return undefined;
  const idx = String(Math.round(num(row.score)));
  return legend[idx] != null ? String(legend[idx]) : undefined;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
