import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BizException, ReasonCode } from '../../../common/exceptions/biz.exception';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JwtPayload } from '../../auth/jwt-payload';
import { shanghaiDay } from '../daily-report';
import { DeepseekService } from '../deepseek.service';
import { INTENT_SYSTEM } from '../prompts/intent.system';
import { NARRATE_SYSTEM } from '../prompts/narrate.system';
import { AiToolsService } from '../tools/ai-tools.service';
import {
  ChatIntent,
  IntentParams,
  isChatIntent,
  matchByKeyword,
  runTool,
  ToolCallRecord,
} from '../tools/tool-registry';
import { numbersMatchFacts, QUOTA_EXCEEDED, renderTemplate, WRITE_REFUSE } from './guardrail';
import { QuotaService } from './quota.service';

interface SessionTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatResult {
  sessionId: string;
  answer: string;
  intent: ChatIntent;
  facts: Record<string, unknown>;
  card: Record<string, unknown> | null;
  fallbackUsed: boolean;
  quota: { usedToday: number; limit: number };
}

/** 需要解读时才走第二段模型；简单口径一律模板。 */
const NARRATE_INTENTS = new Set<ChatIntent>(['coupon_performance', 'lost_members']);

@Injectable()
export class ChatService {
  private readonly logger = new Logger('AiChat');
  private readonly sessions = new Map<string, SessionTurn[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: AiToolsService,
    private readonly deepseek: DeepseekService,
    private readonly quota: QuotaService,
  ) {}

  async chat(user: JwtPayload, message: string, sessionId?: string): Promise<ChatResult> {
    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '仅商家账号可使用经营助手');
    }

    const sid = sessionId?.trim() || this.newSessionId(merchantId);

    const consumed = this.quota.tryConsume(merchantId);
    if (!consumed.ok) {
      return {
        sessionId: sid,
        answer: QUOTA_EXCEEDED,
        intent: 'unknown',
        facts: {},
        card: null,
        fallbackUsed: true,
        quota: { usedToday: consumed.usedToday, limit: consumed.limit },
      };
    }

    const history = this.sessions.get(sid) ?? [];
    const plan = await this.resolveIntent(message, history);
    let intent = plan.intent;
    let params = plan.params;

    if (intent === 'write_request') {
      const answer = WRITE_REFUSE;
      this.pushHistory(sid, message, answer);
      await this.logChat(merchantId, sid, intent, [], true, { message }, { answer });
      return {
        sessionId: sid,
        answer,
        intent,
        facts: {},
        card: null,
        fallbackUsed: false,
        quota: { usedToday: consumed.usedToday, limit: consumed.limit },
      };
    }

    const { facts, toolCalls, truncated } = await runTool(this.tools, intent, params, merchantId);

    let fallbackUsed = false;
    let answer = renderTemplate(intent, facts, truncated);

    if (NARRATE_INTENTS.has(intent) && !facts.error && this.deepseek.configured()) {
      const narrated = await this.tryNarrate(intent, facts);
      if (narrated) {
        // 叙述段禁止数字；若模型违规带数字且对不上 facts → 回退模板
        if (!/\d/.test(narrated) || numbersMatchFacts(narrated, facts)) {
          answer = `${answer}\n${narrated}`;
        } else {
          fallbackUsed = true;
        }
      } else {
        fallbackUsed = true;
      }
    }

    // 工具失败时给静态卡片（昨日摘要）
    let card: Record<string, unknown> | null = null;
    if (facts.error) {
      fallbackUsed = true;
      try {
        const y = shanghaiDay(-1).ymd;
        const summary = await this.tools.businessSummary(merchantId, y, y, 'prev_period');
        card = summary.items[0] ?? null;
        answer = 'AI 暂时不可用，下面是你的数据';
      } catch {
        /* keep template error text */
      }
    }

    this.pushHistory(sid, message, answer);
    await this.logChat(merchantId, sid, intent, toolCalls, !fallbackUsed || toolCalls.every((t) => t.ok), {
      message,
      params,
    }, { answer, facts });

    return {
      sessionId: sid,
      answer,
      intent,
      facts,
      card,
      fallbackUsed,
      quota: { usedToday: consumed.usedToday, limit: consumed.limit },
    };
  }

  private async resolveIntent(
    message: string,
    history: SessionTurn[],
  ): Promise<{ intent: ChatIntent; params: IntentParams }> {
    const keyword = matchByKeyword(message);
    if (!this.deepseek.configured()) return keyword;

    const ctx = history
      .slice(-6)
      .map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.text}`)
      .join('\n');
    const userPayload = ctx ? `近期对话：\n${ctx}\n\n当前问题：${message}` : message;

    try {
      const raw = await this.deepseek.completeJson(INTENT_SYSTEM, userPayload);
      if (!raw || typeof raw !== 'object') return keyword;
      const intentRaw = (raw as { intent?: unknown }).intent;
      const paramsRaw = (raw as { params?: unknown }).params;
      if (!isChatIntent(intentRaw)) return keyword;
      const params: IntentParams =
        paramsRaw && typeof paramsRaw === 'object' ? sanitizeParams(paramsRaw as Record<string, unknown>) : {};
      // 相对时间词由关键词兜底定日历，避免模型编出离谱 from/to
      const merged: IntentParams = { ...keyword.params, ...params };
      if (/昨天|前天|今天|今日|本周|这周|上周/.test(message)) {
        if (keyword.params.from) merged.from = keyword.params.from;
        if (keyword.params.to) merged.to = keyword.params.to;
      }
      return { intent: intentRaw, params: merged };
    } catch (e) {
      this.logger.warn(`意图识别降级：${(e as Error).message}`);
      return keyword;
    }
  }

  private async tryNarrate(intent: ChatIntent, facts: Record<string, unknown>): Promise<string | null> {
    try {
      const raw = await this.deepseek.completeJson(
        NARRATE_SYSTEM,
        JSON.stringify({ intent, facts: stripIdentity(facts) }),
      );
      const answer = typeof (raw as { answer?: unknown })?.answer === 'string'
        ? (raw as { answer: string }).answer.trim()
        : '';
      return answer || null;
    } catch (e) {
      this.logger.warn(`叙述降级：${(e as Error).message}`);
      return null;
    }
  }

  private newSessionId(merchantId: number): string {
    const day = shanghaiDay(0).ymd.replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 6);
    return `${merchantId}-${day}-${rand}`;
  }

  private pushHistory(sessionId: string, userText: string, assistantText: string) {
    const list = this.sessions.get(sessionId) ?? [];
    list.push({ role: 'user', text: userText }, { role: 'assistant', text: assistantText });
    this.sessions.set(sessionId, list.slice(-6));
  }

  private async logChat(
    merchantId: number,
    sessionId: string,
    intent: string,
    toolCalls: ToolCallRecord[],
    ok: boolean,
    request: unknown,
    response: unknown,
  ) {
    try {
      await this.prisma.aiCallLog.create({
        data: {
          provider: 'chat',
          purpose: intent.slice(0, 40),
          merchantId,
          ok,
          latencyMs: 0,
          sessionId,
          intent: intent.slice(0, 40),
          toolCalls: toolCalls as unknown as Prisma.InputJsonValue,
          requestJson: request as Prisma.InputJsonValue,
          responseJson: response as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.logger.warn(`ai_call_logs 写入失败：${(e as Error).message}`);
    }
  }
}

function sanitizeParams(raw: Record<string, unknown>): IntentParams {
  const out: IntentParams = {};
  if (typeof raw.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.from)) out.from = raw.from;
  if (typeof raw.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.to)) out.to = raw.to;
  if (raw.compare === 'prev_period' || raw.compare === 'prev_month') out.compare = raw.compare;
  if (typeof raw.days === 'number' && raw.days >= 1 && raw.days <= 30) out.days = Math.floor(raw.days);
  if (typeof raw.limit === 'number' && raw.limit >= 1 && raw.limit <= 50) out.limit = Math.floor(raw.limit);
  if (typeof raw.offset === 'number' && raw.offset >= 0) out.offset = Math.floor(raw.offset);
  return out;
}

/** Prompt 不得含可识别隐私字段 */
function stripIdentity(facts: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(facts)) as Record<string, unknown>;
  const scrub = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(o)) {
        if (/name|phone|nickname|merchant/i.test(k)) continue;
        next[k] = scrub(val);
      }
      return next;
    }
    return v;
  };
  return scrub(clone) as Record<string, unknown>;
}
