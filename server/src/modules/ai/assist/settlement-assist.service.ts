import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ReportStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JwtPayload } from '../../auth/jwt-payload';
import { SettlementService } from '../../settlement/settlement.service';
import { numbersMatchFacts } from '../chat/guardrail';
import { DeepseekService } from '../deepseek.service';
import { SETTLEMENT_NARRATE_SYSTEM } from '../prompts/settlement-narrate.system';

/** 单个账单核销明细行（与 SettlementService 快照结构一致） */
interface SettlementRow {
  id: number;
  code: string | null;
  userId: number;
  storeId: number | null;
  storeName: string | null;
  faceValue: number;
  discountAmount: number;
  redeemedAt: string;
}

export interface SettlementCheck {
  level: 'ok' | 'info' | 'warn';
  /** 严重项：出现则不建议直接确认 */
  critical?: boolean;
  title: string;
  detail: string;
}

export interface SettlementPoint {
  tone: 'good' | 'warn' | 'info';
  text: string;
}

/** 深夜核销窗口：0–5 点。这个时段核销异常占比高，是最实用的一条风控线。 */
const NIGHT_START = 0;
const NIGHT_END = 5;
/** 同一会员当期核销次数达到此值提示，达到 criticalAt 判为需要核实 */
const SAME_USER_HINT = 3;
const SAME_USER_CRITICAL = 5;
/** 深夜核销占比阈值 */
const NIGHT_RATIO_HINT = 0.2;
/** 单笔面值超过均值的倍数 */
const FACE_OUTLIER_RATIO = 3;

/**
 * AI 结算助手（商家端）。
 *
 * 定位：把「对账单」从一堆数字变成「能不能确认、凭什么」。
 * 原则与发分协同一致 —— 模型不参与任何数字计算，所有结论来自数据库聚合；
 * 模型只负责把结论说得像人话，且被禁止输出数字。
 */
@Injectable()
export class SettlementAssistService {
  private readonly logger = new Logger('AiSettlement');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementService,
    private readonly deepseek: DeepseekService,
  ) {}

  // ---------------------------------------------------------------- 总览

  async overview(user: JwtPayload) {
    const scope = await this.resolveScope(user);

    const [grouped, recent] = await Promise.all([
      this.prisma.settlementReport.groupBy({
        by: ['status'],
        where: scope,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.settlementReport.findMany({
        where: scope,
        orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
        take: 20,
        select: {
          id: true,
          reportNo: true,
          periodStart: true,
          periodEnd: true,
          status: true,
          totalAmount: true,
          totalCount: true,
        },
      }),
    ]);

    const pick = (s: ReportStatus) => {
      const hit = grouped.find((g) => g.status === s);
      return { count: hit?._count._all ?? 0, amount: Number(hit?._sum.totalAmount ?? 0) };
    };

    const pending = pick(ReportStatus.GENERATED);
    const confirmed = pick(ReportStatus.CONFIRMED);
    const disputed = pick(ReportStatus.DISPUTED);

    const mapBill = (r: (typeof recent)[number]) => ({
      id: r.id,
      reportNo: r.reportNo,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      status: r.status as string,
      totalAmount: Number(r.totalAmount),
      totalCount: r.totalCount,
    });

    /** 图表用最近 6 期（正序，左旧右新） */
    const trend = [...recent.slice(0, 6)].reverse().map(mapBill);
    /** 列表用全部 20 条（倒序，最新在上） */
    const bills = recent.map(mapBill);

    const latest = trend.length ? trend[trend.length - 1] : null;
    const prev = trend.length > 1 ? trend[trend.length - 2] : null;
    const latestDelta = latest && prev ? deltaPct(latest.totalAmount, prev.totalAmount) : null;

    const headline = this.buildHeadline({ pending, confirmed, disputed });
    const points = this.buildOverviewPoints({ pending, confirmed, disputed, latest, latestDelta });

    const narration = await this.narrate({
      scene: 'overview',
      pendingCount: pending.count,
      pendingAmount: pending.amount,
      confirmedCount: confirmed.count,
      confirmedAmount: confirmed.amount,
      disputedCount: disputed.count,
      latestAmount: latest?.totalAmount ?? 0,
      latestCount: latest?.totalCount ?? 0,
      latestDelta,
    });

    return {
      pending,
      confirmed,
      disputed,
      latest,
      latestDelta,
      trend,
      bills,
      insight: {
        headline: narration ?? headline,
        source: narration ? 'llm' : 'template',
        points,
      },
    };
  }

  // ---------------------------------------------------------------- 单账单核查

  async billInsight(id: number, user: JwtPayload) {
    // detail() 内部已做主体/附属可见性校验，这里直接复用，避免两套权限判断
    const bill = await this.settlements.detail(id, user);
    const rows = (bill.redemptions ?? []) as unknown as SettlementRow[];
    const totalAmount = Number(bill.totalAmount ?? 0);
    const totalCount = rows.length || Number(bill.totalCount ?? 0);

    const hourly = new Array<number>(24).fill(0);
    const storeMap = new Map<string, { count: number; amount: number }>();
    const userMap = new Map<number, number>();
    const codeMap = new Map<string, number>();
    let faceSum = 0;
    let maxFace = 0;

    for (const r of rows) {
      const store = r.storeName || '本店';
      const cur = storeMap.get(store) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += Number(r.faceValue) || 0;
      storeMap.set(store, cur);

      hourly[hourInShanghai(r.redeemedAt)] += 1;
      userMap.set(r.userId, (userMap.get(r.userId) ?? 0) + 1);
      if (r.code) codeMap.set(r.code, (codeMap.get(r.code) ?? 0) + 1);

      const face = Number(r.faceValue) || 0;
      faceSum += face;
      if (face > maxFace) maxFace = face;
    }

    const avgFace = totalCount > 0 ? faceSum / totalCount : 0;
    const checks = this.buildChecks({
      totalCount,
      avgFace,
      maxFace,
      hourly,
      userMap,
      codeMap,
      storeMap,
    });

    const criticalCount = checks.filter((c) => c.critical).length;
    const warnCount = checks.filter((c) => c.level === 'warn').length;
    const canConfirm = criticalCount === 0;

    const prev = await this.prisma.settlementReport.findFirst({
      where: {
        merchantId: bill.merchantId ?? null,
        id: { not: id },
        periodStart: { lt: new Date(bill.periodStart) },
      },
      orderBy: { periodStart: 'desc' },
      select: { totalAmount: true, periodStart: true, periodEnd: true },
    });
    const prevAmount = prev ? Number(prev.totalAmount) : null;
    const delta = prevAmount == null ? null : deltaPct(Number(bill.totalAmount), prevAmount);

    const byStore = [...storeMap.entries()]
      .map(([name, v]) => ({ name, count: v.count, amount: round2(v.amount) }))
      .sort((a, b) => b.amount - a.amount);

    const headline = this.buildBillHeadline({
      totalCount,
      totalAmount,
      canConfirm,
      warnCount,
      criticalCount,
      delta,
    });

    const narration = await this.narrate({
      scene: 'bill',
      totalCount,
      totalAmount,
      avgFace: round2(avgFace),
      delta,
      warnCount,
      criticalCount,
      storeCount: byStore.length,
    });

    return {
      bill: {
        id: bill.id,
        reportNo: bill.reportNo,
        merchantName: bill.merchantName,
        status: bill.status,
        periodStart: new Date(bill.periodStart).toISOString(),
        periodEnd: new Date(bill.periodEnd).toISOString(),
        totalAmount,
        totalCount: Number(bill.totalCount ?? totalCount),
        disputeReason: bill.disputeReason,
        confirmedAt: bill.confirmedAt,
      },
      hourly,
      byStore,
      checks,
      verdict: {
        canConfirm,
        reason: canConfirm
          ? criticalCount === 0 && warnCount === 0
            ? '数据未见异常，可以直接确认'
            : `存在 ${warnCount} 项提示，均不影响确认，建议扫一眼明细`
          : `发现 ${criticalCount} 项需要核实的异常，建议先核对明细再确认`,
      },
      disputeDraft: this.buildDisputeDraft(checks),
      prevCompare:
        prevAmount == null
          ? null
          : {
              amount: prevAmount,
              delta,
              periodStart: prev!.periodStart.toISOString(),
              periodEnd: prev!.periodEnd.toISOString(),
            },
      insight: {
        headline: narration ?? headline,
        source: narration ? 'llm' : 'template',
        points: this.buildBillPoints({ totalCount, totalAmount, delta, warnCount, criticalCount }),
      },
    };
  }

  // ---------------------------------------------------------------- 规则

  private buildChecks(input: {
    totalCount: number;
    avgFace: number;
    maxFace: number;
    hourly: number[];
    userMap: Map<number, number>;
    codeMap: Map<string, number>;
    storeMap: Map<string, { count: number; amount: number }>;
  }): SettlementCheck[] {
    const checks: SettlementCheck[] = [];

    if (input.totalCount === 0) {
      checks.push({
        level: 'info',
        title: '本期无核销',
        detail: '该账期内没有成功核销记录，应付金额为 0，可直接确认。',
      });
      return checks;
    }

    // 1. 券码重复（理论上不该发生，出现即为数据问题）
    const dupCodes = [...input.codeMap.entries()].filter(([, n]) => n > 1);
    if (dupCodes.length > 0) {
      checks.push({
        level: 'warn',
        critical: true,
        title: '存在重复券码',
        detail: `${dupCodes.length} 个券码在本期出现多次核销记录，属于数据异常，请提交异议后重新生成对账单。`,
      });
    }

    // 2. 同一会员多次核销
    const heavyUsers = [...input.userMap.entries()].filter(([, n]) => n >= SAME_USER_HINT);
    const criticalUsers = heavyUsers.filter(([, n]) => n >= SAME_USER_CRITICAL);
    if (heavyUsers.length > 0) {
      const max = Math.max(...heavyUsers.map(([, n]) => n));
      checks.push({
        level: 'warn',
        critical: criticalUsers.length > 0,
        title: '同一会员多次核销',
        detail:
          `${heavyUsers.length} 位会员在本期核销 ${SAME_USER_HINT} 次以上，最多 ${max} 次。` +
          '如为分单消费属正常，若集中在同一天请核实是否为刷单。',
      });
    }

    // 3. 深夜核销占比
    const night =
      input.hourly.slice(NIGHT_START, NIGHT_END).reduce((s, n) => s + n, 0) || 0;
    const nightRatio = input.totalCount > 0 ? night / input.totalCount : 0;
    if (nightRatio >= NIGHT_RATIO_HINT) {
      checks.push({
        level: 'warn',
        title: '深夜核销占比偏高',
        detail: `${night} 笔发生在 0–5 点，占本期 ${(nightRatio * 100).toFixed(1)}%。请确认该时段确有营业。`,
      });
    }

    // 4. 单笔面值异常
    if (input.avgFace > 0 && input.maxFace > input.avgFace * FACE_OUTLIER_RATIO) {
      checks.push({
        level: 'info',
        title: '存在面值偏高的核销',
        detail: `最大单笔面值 ${fmt(input.maxFace)} 元，是本期均值 ${fmt(round2(input.avgFace))} 元的 ${(input.maxFace / input.avgFace).toFixed(1)} 倍。`,
      });
    }

    // 5. 门店集中度
    if (input.storeMap.size > 1) {
      const sorted = [...input.storeMap.values()].sort((a, b) => b.count - a.count);
      const top = sorted[0];
      const ratio = top.count / input.totalCount;
      if (ratio >= 0.9) {
        checks.push({
          level: 'info',
          title: '核销集中在单一门店',
          detail: `单一门店占本期 ${(ratio * 100).toFixed(0)}% 的核销，如为正常经营分布可忽略。`,
        });
      }
    }

    if (!checks.length) {
      checks.push({
        level: 'ok',
        title: '未发现异常',
        detail: '券码唯一、核销时段与门店分布正常，可直接确认。',
      });
    }

    return checks;
  }

  private buildDisputeDraft(checks: SettlementCheck[]): string {
    const serious = checks.filter((c) => c.critical);
    if (!serious.length) return '';
    const lines = serious.map((c) => `· ${c.title}：${c.detail}`);
    return `对本期数据存疑，请核实以下问题后重新生成对账单：\n${lines.join('\n')}`;
  }

  private buildHeadline(x: {
    pending: { count: number; amount: number };
    confirmed: { count: number; amount: number };
    disputed: { count: number };
  }): string {
    if (x.pending.count > 0) {
      return `有 ${x.pending.count} 张账单待确认，合计 ¥${fmt(x.pending.amount)}`;
    }
    if (x.disputed.count > 0) {
      return `${x.disputed.count} 张账单存在异议，需核实后重新生成`;
    }
    if (x.confirmed.count > 0) {
      return `账期已全部确认，累计已结 ¥${fmt(x.confirmed.amount)}`;
    }
    return '还没有生成对账单，下个账期会自动生成';
  }

  private buildOverviewPoints(x: {
    pending: { count: number; amount: number };
    confirmed: { count: number; amount: number };
    disputed: { count: number };
    latest: { periodStart: string; periodEnd: string; totalAmount: number; totalCount: number } | null;
    latestDelta: number | null;
  }): SettlementPoint[] {
    const points: SettlementPoint[] = [];

    if (x.latest) {
      const range = `${ymdCn(x.latest.periodStart)}–${ymdCn(x.latest.periodEnd)}`;
      if (x.latestDelta == null) {
        points.push({
          tone: 'info',
          text: `最近账期 ${range}：应付 ¥${fmt(x.latest.totalAmount)}，共 ${x.latest.totalCount} 笔核销`,
        });
      } else {
        points.push({
          tone: x.latestDelta > 10 ? 'good' : x.latestDelta < -10 ? 'warn' : 'info',
          text: `最近账期 ${range}：应付 ¥${fmt(x.latest.totalAmount)}，较上期 ${x.latestDelta > 0 ? '+' : ''}${x.latestDelta}%`,
        });
      }
    }

    if (x.pending.count > 0) {
      points.push({
        tone: 'warn',
        text: `${x.pending.count} 张待确认账单合计 ¥${fmt(x.pending.amount)}，确认后进入结算流程`,
      });
    }

    if (x.disputed.count > 0) {
      points.push({
        tone: 'warn',
        text: `${x.disputed.count} 张账单存在异议，需重新生成后才能再次确认`,
      });
    }

    if (!points.length) {
      points.push({ tone: 'info', text: '暂无对账数据，等第一个账期结束即可查看' });
    }

    return points;
  }

  private buildBillHeadline(x: {
    totalCount: number;
    totalAmount: number;
    canConfirm: boolean;
    warnCount: number;
    criticalCount: number;
    delta: number | null;
  }): string {
    const base = `本期 ${x.totalCount} 笔核销，应付 ¥${fmt(x.totalAmount)}`;
    const deltaText =
      x.delta == null ? '' : `，较上期 ${x.delta > 0 ? '+' : ''}${x.delta}%`;
    if (!x.canConfirm) return `${base}${deltaText}，发现 ${x.criticalCount} 项异常需先核实`;
    if (x.warnCount > 0) return `${base}${deltaText}，有 ${x.warnCount} 项提示待留意`;
    return `${base}${deltaText}，数据正常`;
  }

  private buildBillPoints(x: {
    totalCount: number;
    totalAmount: number;
    delta: number | null;
    warnCount: number;
    criticalCount: number;
  }): SettlementPoint[] {
    const points: SettlementPoint[] = [];
    if (x.totalCount > 0) {
      points.push({
        tone: 'info',
        text: `平均每笔 ¥${fmt(round2(x.totalAmount / x.totalCount))}`,
      });
    }
    if (x.delta != null) {
      points.push({
        tone: x.delta > 10 ? 'good' : x.delta < -10 ? 'warn' : 'info',
        text: `较上期 ${x.delta > 0 ? '+' : ''}${x.delta}%`,
      });
    }
    if (x.criticalCount > 0) {
      points.push({ tone: 'warn', text: `${x.criticalCount} 项异常建议先核实再确认` });
    } else if (x.warnCount > 0) {
      points.push({ tone: 'info', text: `${x.warnCount} 项提示不影响确认` });
    }
    return points;
  }

  // ---------------------------------------------------------------- 叙述（可选）

  private async narrate(facts: Record<string, unknown>): Promise<string | null> {
    if (!this.deepseek.configured()) return null;
    try {
      const raw = await this.deepseek.completeJson(
        SETTLEMENT_NARRATE_SYSTEM,
        JSON.stringify(facts),
      );
      const text =
        typeof (raw as { answer?: unknown })?.answer === 'string'
          ? (raw as { answer: string }).answer.trim()
          : '';
      if (!text) return null;
      // 结算场景零容忍：只要出现阿拉伯数字且对不上事实，就丢弃模型文案
      if (/\d/.test(text) && !numbersMatchFacts(text, facts)) return null;
      return text;
    } catch (e) {
      this.logger.warn(`结算叙述降级：${(e as Error).message}`);
      return null;
    }
  }

  /** 与 SettlementService.settlementScope 同语义：平台全量、主体全量、附属只看自己 */
  private async resolveScope(user: JwtPayload): Promise<Prisma.SettlementReportWhereInput> {
    if (user.userType === 'PLATFORM') return {};
    if (user.userType === 'STORE') return { id: -1 };
    const merchantId = user.merchantId;
    if (!merchantId) return { id: -1 };
    const me = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { type: true },
    });
    if (me?.type === 'MAIN') return {};
    return { merchantId };
  }
}

function hourInShanghai(iso: string): number {
  const h = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date(iso)),
  );
  return Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 0;
}

function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Number((((cur - prev) / prev) * 100).toFixed(1));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function ymdCn(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(iso))
    .replace(/\//g, '.');
}
