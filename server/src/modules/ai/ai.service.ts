import { Injectable, Logger } from '@nestjs/common';
import { MerchantStatus, NotifyLevel, Prisma, ReceiverType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { JwtPayload } from '../auth/jwt-payload';
import { NotificationService } from '../notification/notification.service';
import { DeepseekService } from './deepseek.service';
import { changePct, fallbackStatus, formatDailyReport, ReportStatus, shanghaiDay, templateCopy } from './daily-report';
import { LayaService } from './laya.service';

export interface DailyReport {
  merchantId: number;
  merchantName: string;
  day: string;
  status: ReportStatus;
  summary: string;
  suggestions: string[];
  metrics: {
    orders: number;
    redemptions: number;
    pointsIssued: number;
    pointsSpent: number;
    orderChangeVsYesterday: number | null;
    redeemChangeVsYesterday: number | null;
    orderChangeVsLastWeek: number | null;
    highValueCustomers: number;
    churnCustomers: number;
  };
  statusSource: 'laya' | 'fallback';
  copySource: 'deepseek' | 'template';
  skipped: boolean;
  notificationId: number | null;
}

const STATUS_LABELS = ['优秀', '正常', '需关注'] as const;

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiReport');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly laya: LayaService,
    private readonly deepseek: DeepseekService,
    private readonly notifications: NotificationService,
  ) {}

  /** 给全部已审核商家出当天日报。进程内互斥，重复触发直接跳过。 */
  async runAll(): Promise<{ skipped: boolean; reports: DailyReport[] }> {
    if (this.running) return { skipped: true, reports: [] };
    this.running = true;
    try {
      const merchants = await this.prisma.merchant.findMany({
        where: { status: MerchantStatus.APPROVED },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      });
      const reports: DailyReport[] = [];
      for (const merchant of merchants) {
        reports.push(await this.runOne(merchant.id, merchant.name));
      }
      return { skipped: false, reports };
    } finally {
      this.running = false;
    }
  }

  async runOne(merchantId: number, merchantName?: string): Promise<DailyReport> {
    const name =
      merchantName ??
      (await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { name: true } }))?.name ??
      `商家#${merchantId}`;
    const today = shanghaiDay(0);
    const yesterday = shanghaiDay(-1);
    const lastWeek = shanghaiDay(-7);

    const existing = await this.prisma.notification.findFirst({
      where: {
        receiverType: ReceiverType.MERCHANT,
        receiverId: merchantId,
        bizType: 'AI_DAILY_REPORT',
        bizId: today.bizId,
      },
      select: { id: true, content: true },
    });
    if (existing) {
      const parsed = parseReport(existing.content);
      return {
        merchantId,
        merchantName: name,
        day: today.ymd,
        status: parsed.status,
        summary: parsed.summary,
        suggestions: parsed.suggestions,
        metrics: emptyMetrics(),
        statusSource: 'fallback',
        copySource: 'template',
        skipped: true,
        notificationId: existing.id,
      };
    }

    const [orders, ordersY, ordersW, redemptions, redemptionsY, pointsIssued, pointsSpent, customers] =
      await Promise.all([
        this.countOrders(merchantId, today.from, today.to),
        this.countOrders(merchantId, yesterday.from, yesterday.to),
        this.countOrders(merchantId, lastWeek.from, lastWeek.to),
        this.countRedemptions(merchantId, today.from, today.to),
        this.countRedemptions(merchantId, yesterday.from, yesterday.to),
        this.sumPoints(merchantId, 'EARN', today.from, today.to),
        this.sumPoints(merchantId, 'SPEND', today.from, today.to),
        this.customerSignals(merchantId),
      ]);

    const orderChange = changePct(orders, ordersY);
    const redeemChange = changePct(redemptions, redemptionsY);
    const weekChange = changePct(orders, ordersW);

    const status = await this.judgeStatus(merchantId, {
      orders,
      orderChange,
      redemptions,
      redeemChange,
      weekChange,
      churn: customers.churn,
    });

    const facts = {
      merchantName: name,
      day: today.ymd,
      status: status.value,
      orders,
      orderChange,
      redemptions,
      redeemChange,
      weekChange,
      pointsIssued,
      pointsSpent,
      highValue: customers.highValue,
      churn: customers.churn,
    };
    const copy = await this.writeCopy(merchantId, facts);

    const content = formatDailyReport({
      status: status.value,
      summary: copy.summary,
      suggestions: copy.suggestions,
    });

    const sent = await this.notifications.deliverSystem({
      receiverType: ReceiverType.MERCHANT,
      receiverId: merchantId,
      title: `AI经营日报 ${today.ymd}`,
      content,
      level: status.value === '需关注' ? NotifyLevel.IMPORTANT : NotifyLevel.NORMAL,
      bizType: 'AI_DAILY_REPORT',
      bizId: today.bizId,
    });

    return {
      merchantId,
      merchantName: name,
      day: today.ymd,
      status: status.value,
      summary: copy.summary,
      suggestions: copy.suggestions,
      metrics: {
        orders,
        redemptions,
        pointsIssued,
        pointsSpent,
        orderChangeVsYesterday: orderChange,
        redeemChangeVsYesterday: redeemChange,
        orderChangeVsLastWeek: weekChange,
        highValueCustomers: customers.highValue,
        churnCustomers: customers.churn,
      },
      statusSource: status.source,
      copySource: copy.source,
      skipped: false,
      notificationId: sent.id,
    };
  }

  /** 状态判断：Laya choice。失败则用 fallbackStatus，并记 ai_call_logs。 */
  private async judgeStatus(
    merchantId: number,
    facts: {
      orders: number;
      orderChange: number | null;
      redemptions: number;
      redeemChange: number | null;
      weekChange: number | null;
      churn: number;
    },
  ): Promise<{ value: ReportStatus; source: 'laya' | 'fallback' }> {
    const state = `商家今日订单 ${facts.orders} 笔，较昨日 ${facts.orderChange ?? '无基数'}%，较上周同日 ${facts.weekChange ?? '无基数'}%；核销 ${facts.redemptions} 笔，较昨日 ${facts.redeemChange ?? '无基数'}%；45天未到店 ${facts.churn} 人。`;
    const questions = {
      status: {
        type: 'choice',
        instructions: '根据经营数字判断今天的状态，只选一个',
        criteria: {
          优秀: '订单或核销明显增长，且没有明显流失',
          正常: '与昨日、上周差不多，波动不大',
          需关注: '订单或核销下降超过一成，或流失客户偏多',
        },
      },
    };
    const started = Date.now();
    try {
      const decision = await this.laya.decide(state, questions);
      const hit = decision.answers.find((a) => a.question === 'status');
      const label = STATUS_LABELS.find((s) => s === hit?.label);
      await this.logCall(merchantId, 'laya', 'daily-status', true, Date.now() - started, state, decision.raw, null);
      if (!label) return { value: fallbackStatus({ orderChange: facts.orderChange, redeemChange: facts.redeemChange, churnCount: facts.churn }), source: 'fallback' };
      return { value: label, source: 'laya' };
    } catch (e) {
      const message = (e as Error).message.slice(0, 250);
      await this.logCall(merchantId, 'laya', 'daily-status', false, Date.now() - started, state, null, message);
      this.logger.warn(`商家 ${merchantId} Laya 降级：${message}`);
      return {
        value: fallbackStatus({ orderChange: facts.orderChange, redeemChange: facts.redeemChange, churnCount: facts.churn }),
        source: 'fallback',
      };
    }
  }

  /** 文案：有 DeepSeek 密钥就写；否则或失败时用模板。 */
  private async writeCopy(
    merchantId: number,
    facts: Parameters<typeof templateCopy>[0],
  ): Promise<{ summary: string; suggestions: string[]; source: 'deepseek' | 'template' }> {
    const backup = templateCopy(facts);
    if (!this.deepseek.configured()) return { ...backup, source: 'template' };
    const started = Date.now();
    try {
      const raw = await this.deepseek.completeJson(
        '你是商家经营助理。只根据给定数字写日报，禁止编造天气、活动或未提供的客户姓名。返回 JSON：{"summary":"不超过80字","suggestions":["不超过3条，每条不超过30字"]}',
        JSON.stringify(facts),
      );
      const summary = typeof (raw as { summary?: unknown })?.summary === 'string' ? (raw as { summary: string }).summary.trim() : '';
      const suggestions = Array.isArray((raw as { suggestions?: unknown })?.suggestions)
        ? (raw as { suggestions: unknown[] }).suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 3)
        : [];
      await this.logCall(merchantId, 'deepseek', 'daily-copy', true, Date.now() - started, facts, raw, null);
      if (!summary) return { ...backup, source: 'template' };
      return { summary, suggestions: suggestions.length ? suggestions : backup.suggestions, source: 'deepseek' };
    } catch (e) {
      const message = (e as Error).message.slice(0, 250);
      await this.logCall(merchantId, 'deepseek', 'daily-copy', false, Date.now() - started, facts, null, message);
      this.logger.warn(`商家 ${merchantId} DeepSeek 降级：${message}`);
      return { ...backup, source: 'template' };
    }
  }

  private static readonly RISK_LABELS = ['正常消费', '疑似合谋套现', '疑似刷单', '系统误判'] as const;

  /**
   * 异常订单归因。只根据库里已有的消费次数、商家和异常率，不编造同 IP / 同设备。
   * Laya 超时则：近 1 小时超过 3 单 → 疑似刷单，否则正常消费。
   */
  async analyzeAbnormal(actor: JwtPayload, orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        userId: true,
        merchantId: true,
        storeId: true,
        status: true,
        payAmount: true,
        user: { select: { nickname: true, phone: true } },
      },
    });
    if (!order || order.status !== 'ABNORMAL') {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '异常订单不存在');
    }
    await this.assertOrderVisible(actor, order);

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.prisma.order.findMany({
      where: { userId: order.userId, createdAt: { gte: since }, status: { not: 'CANCELED' } },
      select: { merchantId: true, payAmount: true },
    });
    const merchantIds = [...new Set(recent.map((row) => row.merchantId))];
    const merchants = merchantIds.length
      ? await this.prisma.merchant.findMany({
          where: { id: { in: merchantIds } },
          select: { id: true, name: true, contactPhone: true },
        })
      : [];
    const phoneBuckets = new Map<string, number>();
    for (const merchant of merchants) {
      const phone = (merchant.contactPhone || '').trim();
      if (!phone) continue;
      phoneBuckets.set(phone, (phoneBuckets.get(phone) ?? 0) + 1);
    }
    const sameOwner = [...phoneBuckets.values()].some((count) => count >= 2);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [weekTotal, weekAbnormal] = await Promise.all([
      this.prisma.order.count({ where: { merchantId: order.merchantId, createdAt: { gte: weekAgo } } }),
      this.prisma.order.count({
        where: { merchantId: order.merchantId, status: 'ABNORMAL', createdAt: { gte: weekAgo } },
      }),
    ]);
    const abnormalRate = weekTotal === 0 ? 0 : weekAbnormal / weekTotal;
    const amount = recent.reduce((sum, row) => sum + Number(row.payAmount), 0);
    const reasons: string[] = [];
    if (recent.length > 3) reasons.push('频次异常');
    if (merchantIds.length >= 2 && sameOwner) reasons.push('同联系电话多店');
    if (abnormalRate >= 0.3) reasons.push('商家异常率偏高');

    const shopNames = merchants.map((item) => item.name).join('、') || '未知商家';
    const state = [
      `用户${order.user.nickname || order.user.phone || order.userId}近 1 小时在 ${merchantIds.length} 家店消费 ${recent.length} 笔，合计 ${amount.toFixed(2)} 元。`,
      `涉及商家：${shopNames}。`,
      sameOwner ? '其中至少两家店联系电话相同。' : '这些店的联系电话并不相同。',
      `该商家近 7 天订单 ${weekTotal} 笔，异常 ${weekAbnormal} 笔。`,
      '订单没有记录用户 IP 和设备，不能判断是否同设备。',
    ].join('');

    const fallback = this.ruleRisk(recent.length, reasons);
    const questions = {
      risk: {
        type: 'choice',
        instructions: '根据下面的消费事实判断这笔异常订单，只选一个，不要编造未提供的 IP 或设备信息',
        criteria: {
          正常消费: '频次和金额都看不出集中消费',
          疑似合谋套现: '短时间多家店且联系电话相同',
          疑似刷单: '1 小时内消费笔数偏多',
          系统误判: '事实不足，更像标记过严',
        },
      },
    };
    const started = Date.now();
    try {
      const decision = await this.laya.decide(state, questions);
      const hit = decision.answers.find((item) => item.question === 'risk');
      const suggestion = AiService.RISK_LABELS.find((label) => label === hit?.label);
      await this.logCall(order.merchantId, 'laya', 'analyze-abnormal', true, Date.now() - started, { state }, decision.raw, null);
      if (!suggestion || !hit) return { ...fallback, fallbackUsed: true };
      return { suggestion, confidence: hit.confidence, reasons, fallbackUsed: false };
    } catch (error) {
      const message = (error as Error).message.slice(0, 250);
      await this.logCall(order.merchantId, 'laya', 'analyze-abnormal', false, Date.now() - started, { state }, null, message);
      this.logger.warn(`异常订单 ${orderId} Laya 降级：${message}`);
      return { ...fallback, fallbackUsed: true };
    }
  }

  /**
   * 执照辅助。仓库里没有腾讯云/阿里云 OCR 密钥，也不读取图片像素。
   * 有 18 位执照号就回显为信用代码；法人姓名留空，交给前端和申请表对比。
   */
  async recognizeLicense(merchantId: number) {
    // TODO(prod): 接入真实的腾讯云/阿里云 OCR API。
    // 当前 source 固定为 mock：不读取执照图片像素，只回显申请表里已有的名称和 18 位执照号。
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true, licenseNo: true, licenseImages: true, contactName: true },
    });
    if (!merchant) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '入驻申请不存在');
    const images = Array.isArray(merchant.licenseImages) ? merchant.licenseImages.filter((item) => typeof item === 'string') : [];
    const creditCode = /^[0-9A-Z]{18}$/.test(merchant.licenseNo || '') ? merchant.licenseNo || '' : '';
    return {
      companyName: merchant.name,
      creditCode,
      legalName: '',
      source: 'mock' as const,
      imageCount: images.length,
      note: images.length
        ? '未配置云 OCR，不能读取执照图片。信用代码来自申请表里已填写的 18 位执照号，法人姓名未能识别。'
        : '该申请没有上传执照图片，且未配置云 OCR。信用代码来自申请表里的执照号，法人姓名为空。',
      form: {
        companyName: merchant.name,
        creditCode: merchant.licenseNo || '',
        legalName: merchant.contactName || '',
      },
    };
  }

  private ruleRisk(orderCount: number, reasons: string[]) {
    if (orderCount > 3) {
      const next = reasons.includes('频次异常') ? reasons : ['频次异常', ...reasons];
      return { suggestion: '疑似刷单' as const, confidence: 0.8, reasons: next };
    }
    return { suggestion: '正常消费' as const, confidence: 0.55, reasons };
  }

  private async assertOrderVisible(actor: JwtPayload, order: { merchantId: number; storeId: number | null }) {
    if (actor.userType === 'PLATFORM') return;
    if (actor.userType === 'STORE') {
      if (order.storeId !== actor.storeId) {
        throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权查看该订单');
      }
      return;
    }
    if (!actor.merchantId) throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权查看该订单');
    if (order.merchantId === actor.merchantId) return;
    const child = await this.prisma.merchant.findFirst({
      where: { id: order.merchantId, parentId: actor.merchantId },
      select: { id: true },
    });
    if (!child) throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权查看该订单');
  }

  /**
   * 扫码录单时判断「刚才那个客人是谁」。
   * Laya 在候选姓名里做 choice；超时或服务不可用时，取 minutesAgo 最小的一条。
   */
  async identifyUser(merchantId: number | null, input: { voiceText: string; recentScans: { id: number; name: string; minutesAgo: number }[] }) {
    const scans = input.recentScans;
    const nearest = scans.reduce((best, cur) => (cur.minutesAgo < best.minutesAgo ? cur : best));
    const labels = choiceLabels(scans);
    const state = `店员语音：「${input.voiceText}」。最近扫码：${scans
      .map((s) => `${labels.get(s.id)}（${s.minutesAgo}分钟前）`)
      .join('，')}。`;
    const criteria: Record<string, string> = {};
    for (const scan of scans) {
      const label = labels.get(scan.id)!;
      criteria[label] = `姓名对应这位客人，${scan.minutesAgo} 分钟前扫过码`;
    }
    const questions = {
      user: {
        type: 'choice',
        instructions: '结合语音和扫码时间，最可能是哪位用户？',
        criteria,
      },
    };
    const started = Date.now();
    try {
      const decision = await this.laya.decide(state, questions);
      const hit = decision.answers.find((a) => a.question === 'user');
      const matched = scans.find((s) => labels.get(s.id) === hit?.label);
      await this.logCall(merchantId, 'laya', 'identify-user', true, Date.now() - started, { state, questions }, decision.raw, null);
      if (!matched || !hit?.label) {
        return { suggestedUserId: nearest.id, confidence: 0, fallbackUsed: true };
      }
      return { suggestedUserId: matched.id, confidence: hit.confidence, fallbackUsed: false };
    } catch (e) {
      const message = (e as Error).message.slice(0, 250);
      await this.logCall(merchantId, 'laya', 'identify-user', false, Date.now() - started, { state, questions }, null, message);
      this.logger.warn(`识别客人降级：${message}`);
      return { suggestedUserId: nearest.id, confidence: 0, fallbackUsed: true };
    }
  }

  private async logCall(
    merchantId: number | null,
    provider: string,
    purpose: string,
    ok: boolean,
    latencyMs: number,
    request: unknown,
    response: unknown,
    error: string | null,
  ) {
    try {
      await this.prisma.aiCallLog.create({
        data: {
          provider,
          purpose,
          merchantId,
          ok,
          latencyMs: Math.max(0, Math.round(latencyMs)),
          error,
          requestJson: request as Prisma.InputJsonValue,
          responseJson: (response ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (e) {
      this.logger.warn(`ai_call_logs 写入失败：${(e as Error).message}`);
    }
  }

  private countOrders(merchantId: number, from: Date, to: Date) {
    return this.prisma.order.count({
      where: { merchantId, createdAt: { gte: from, lt: to }, status: { not: 'CANCELED' } },
    });
  }

  private countRedemptions(merchantId: number, from: Date, to: Date) {
    return this.prisma.redemptionRecord.count({
      where: { merchantId, status: 'SUCCESS', redeemedAt: { gte: from, lt: to } },
    });
  }

  private async sumPoints(merchantId: number, type: 'EARN' | 'SPEND', from: Date, to: Date) {
    const row = await this.prisma.pointTransaction.aggregate({
      where: { merchantId, type, createdAt: { gte: from, lt: to } },
      _sum: { amount: true },
    });
    return Math.abs(Number(row._sum.amount ?? 0));
  }

  /**
   * 高价值：近 90 天订单不少于 2 笔，或实付合计不少于 200。
   * 流失预警：有过订单，且最近一笔早于 45 天前。
   */
  private async customerSignals(merchantId: number): Promise<{ highValue: number; churn: number }> {
    const groups = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { merchantId, status: { not: 'CANCELED' } },
      _count: { _all: true },
      _sum: { payAmount: true },
      _max: { createdAt: true },
    });
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let highValue = 0;
    let churn = 0;
    for (const row of groups) {
      const last = row._max.createdAt?.getTime() ?? 0;
      const pay = Number(row._sum.payAmount ?? 0);
      if (now - last <= 90 * day && (row._count._all >= 2 || pay >= 200)) highValue += 1;
      if (last > 0 && now - last >= 45 * day) churn += 1;
    }
    return { highValue, churn };
  }
}

function emptyMetrics(): DailyReport['metrics'] {
  return {
    orders: 0,
    redemptions: 0,
    pointsIssued: 0,
    pointsSpent: 0,
    orderChangeVsYesterday: null,
    redeemChangeVsYesterday: null,
    orderChangeVsLastWeek: null,
    highValueCustomers: 0,
    churnCustomers: 0,
  };
}

/** 同名客人加上 id，保证 Laya 的 choice 选项不重复。 */
function choiceLabels(scans: { id: number; name: string }[]): Map<number, string> {
  const counts = new Map<string, number>();
  for (const scan of scans) counts.set(scan.name, (counts.get(scan.name) ?? 0) + 1);
  const labels = new Map<number, string>();
  for (const scan of scans) {
    labels.set(scan.id, (counts.get(scan.name) ?? 0) > 1 ? `${scan.name}（${scan.id}）` : scan.name);
  }
  return labels;
}

function parseReport(content: string): { status: ReportStatus; summary: string; suggestions: string[] } {
  if (content.trim().startsWith('{')) {
    try {
      const data = JSON.parse(content) as { status?: string; summary?: string; suggestions?: unknown };
      const status = STATUS_LABELS.find((s) => s === data.status) ?? '正常';
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions.filter((s): s is string => typeof s === 'string') : [];
      return { status, summary: data.summary ?? content, suggestions };
    } catch {
      /* 落到下面的纯文本解析 */
    }
  }
  const status = STATUS_LABELS.find((s) => content.includes(`【状态】${s}`)) ?? '正常';
  const summary = content.match(/【摘要】([\s\S]*?)(?:\n【建议】|$)/)?.[1]?.trim() ?? content;
  const suggestions = [...content.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim());
  return { status, summary, suggestions };
}
