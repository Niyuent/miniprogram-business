import { Injectable, Logger } from '@nestjs/common';
import { CouponInstanceStatus, PointTxnType, Prisma } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BizException, ReasonCode } from '../../../common/exceptions/biz.exception';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JwtPayload } from '../../auth/jwt-payload';
import { EarnPointsDto } from '../../point/dto/point.dto';
import { PointService } from '../../point/point.service';
import { shanghaiDay } from '../daily-report';
import { EarnConfirmDto, EarnProposalDto } from './dto/earn-assist.dto';

/** 建议票据有效期：10 分钟。收银台一笔单不会拖这么久，超时说明人已经走神了。 */
const PROPOSAL_TTL_MS = 10 * 60 * 1000;
/** 大额提醒阈值（元）。超过就要人工核对小票，这是防手误的关键一道。 */
const LARGE_AMOUNT_YUAN = 5000;
/** 同会员当日发分次数达到此值时提示 */
const REPEAT_EARN_HINT = 3;
/** 临期券窗口（天） */
const EXPIRING_COUPON_DAYS = 7;

interface ProposalPayload {
  v: 1;
  /** 建议 id，同时用作发分幂等键（落到 orderNo 上） */
  pid: string;
  /** 商家 id，防跨商家重放 */
  mid: number;
  uid: number;
  aid: number;
  /** 票据中锁定的消费金额，确认时以它为准 */
  amt: number;
  exp: number;
}

export interface EarnMemberContext {
  pointsAvailable: number;
  todayEarnCount: number;
  sameAmountToday: number;
  expiringCoupons: number;
}

export interface EarnRisk {
  level: 'warn' | 'info';
  text: string;
}

/**
 * AI 协同发分。
 *
 * 边界（重要）：模型不参与任何数字计算，积分一律由 PointService.previewEarn 的规则引擎给出；
 * 本服务只做三件事——组装上下文、生成风险提示、签发不可篡改的确认票据。
 *
 * 安全模型：
 * 1. 提议阶段只读，不产生任何写操作；
 * 2. 确认阶段验证 HMAC 票据，金额以票据锁定值为准，前端无法篡改分值；
 * 3. 确认时用最新规则重算一次，避免 10 分钟内规则变更导致多发；
 * 4. 幂等键 pid 落到订单号，重复确认返回首次结果而不是重复入账。
 */
@Injectable()
export class EarnAssistService {
  private readonly logger = new Logger('AiEarnAssist');

  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointService,
  ) {}

  /** 生成发分建议（只读，不写库） */
  async propose(dto: EarnProposalDto, user: JwtPayload) {
    const plan = await this.points.previewEarn(
      {
        userId: dto.userId,
        amount: dto.amount,
        allianceId: dto.allianceId,
        storeId: dto.storeId ?? null,
      },
      user,
    );

    const member = await this.loadMemberContext(plan.merchantId, dto.userId, plan.amount);
    const risks = this.buildRisks(plan, member);
    const suggestion = plan.blocked
      ? String(plan.reason ?? '本次不适合发分')
      : `消费 ¥${fmt(plan.amount)} × ${plan.earnRatio} 分/元 = ${plan.points} 分，确认后立即入账`;

    const pid = `aip-${randomBytes(8).toString('hex')}`;
    const token = this.sign({
      v: 1,
      pid,
      mid: plan.merchantId,
      uid: dto.userId,
      aid: plan.allianceId,
      amt: plan.amount,
      exp: Date.now() + PROPOSAL_TTL_MS,
    });

    return {
      token,
      proposalId: pid,
      allianceId: plan.allianceId,
      allianceName: plan.allianceName,
      amount: plan.amount,
      points: plan.points,
      earnRatio: plan.earnRatio,
      minAmount: plan.minAmount,
      pointsValidMonths: plan.pointsValidMonths,
      blocked: plan.blocked,
      reasonCode: plan.reasonCode,
      reason: plan.reason,
      suggestion,
      member,
      risks,
      expiresIn: Math.floor(PROPOSAL_TTL_MS / 1000),
    };
  }

  /** 确认执行（验签 → 重算 → 复用 point.earn 落库） */
  async confirm(dto: EarnConfirmDto, user: JwtPayload, ip?: string, ua?: string) {
    const payload = this.verify(dto.token);

    // 跨商家重放防护：仅当 JWT 带 merchantId 时比对（店员账号为空，由 point.earn 内部再校验）
    if (user.merchantId && payload.mid !== user.merchantId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '这笔建议不属于当前商家');
    }

    // 幂等重放：同一票据已执行过 → 返回首次结果
    const replayed = await this.replay(payload);
    if (replayed) return replayed;

    // 用最新规则重算，防止票据有效期内规则被改导致多发
    const plan = await this.points.previewEarn(
      { userId: payload.uid, amount: payload.amt, allianceId: payload.aid },
      user,
    );

    if (plan.blocked) {
      return {
        earned: false,
        points: 0,
        allianceId: plan.allianceId,
        allianceName: plan.allianceName,
        reasonCode: plan.reasonCode,
        message: plan.reason,
        idempotent: false,
      };
    }

    let result: Awaited<ReturnType<PointService['earn']>>;
    try {
      result = await this.points.earn(
        {
          userId: payload.uid,
          amount: payload.amt,
          allianceId: payload.aid,
          requestId: payload.pid,
          storeId: plan.storeId ?? undefined,
          // 与手动录单同口径，报表按 remark 归类时不会多出一个新来源
          remark: '扫码录单送积分',
        } as EarnPointsDto,
        user,
        ip,
        ua,
      );
    } catch (e) {
      // 并发确认：另一路已经先落库，按幂等返回首次结果，而不是抛「已送过积分」
      const raced = await this.replay(payload);
      if (raced) return raced;
      await this.logAction(payload, plan.points, false, 0);
      throw e;
    }

    await this.logAction(payload, plan.points, true, plan.points);

    return {
      ...result,
      allianceName: (result as { allianceName?: string }).allianceName ?? plan.allianceName,
      /** 建议时的分值，便于前端核对「说的和发的一致」 */
      proposalPoints: plan.points,
      idempotent: false,
    };
  }

  // ------------------------------------------------------------------ 内部

  /**
   * 同票据幂等重放。
   * point.earn 会把 requestId 拼成订单号 `a{allianceId}-{pid}`，所以按订单号回查即可。
   */
  private async replay(payload: ProposalPayload) {
    const orderNo = this.orderNoOf(payload.aid, payload.pid);
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      select: { id: true },
    });
    if (!order) return null;

    const txn = await this.prisma.pointTransaction.findFirst({
      where: { relatedOrderId: order.id, type: PointTxnType.EARN },
      select: { amount: true, allianceId: true, balanceAfter: true },
    });
    if (!txn) return null;

    return {
      earned: true,
      points: Math.abs(txn.amount),
      allianceId: txn.allianceId,
      balanceAfter: txn.balanceAfter,
      message: '这笔已经发放过，未重复入账',
      proposalPoints: Math.abs(txn.amount),
      idempotent: true,
    };
  }

  private orderNoOf(allianceId: number, pid: string): string {
    return `a${allianceId}-${pid}`.slice(0, 32);
  }

  /**
   * AI 参与的操作必须留痕：谁的建议、建议多少分、最后发了多少分、成功与否。
   * 写日志失败不能影响发分结果，所以整段 try/catch。
   */
  private async logAction(
    payload: ProposalPayload,
    planPoints: number,
    ok: boolean,
    issuedPoints: number,
  ) {
    try {
      await this.prisma.aiCallLog.create({
        data: {
          provider: 'assist',
          purpose: 'earn_assist',
          merchantId: payload.mid,
          ok,
          latencyMs: 0,
          intent: 'earn_assist',
          toolCalls: [{ name: 'previewEarn', ok }] as unknown as Prisma.InputJsonValue,
          requestJson: {
            proposalId: payload.pid,
            userId: payload.uid,
            allianceId: payload.aid,
            amount: payload.amt,
          } as unknown as Prisma.InputJsonValue,
          responseJson: { planPoints, issuedPoints } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.logger.warn(`ai_call_logs 写入失败（不影响发分）：${(e as Error).message}`);
    }
  }

  /** 会员上下文：全部是辅助信息，任一查询失败都不应阻塞发分 */
  private async loadMemberContext(
    merchantId: number,
    userId: number,
    amount: number,
  ): Promise<EarnMemberContext> {
    const today = shanghaiDay(0);
    const now = new Date();
    const expiringBefore = new Date(now.getTime() + EXPIRING_COUPON_DAYS * 86400_000);

    try {
      const [todayEarnCount, sameAmountToday, account, expiringCoupons] = await Promise.all([
        this.prisma.pointTransaction.count({
          where: {
            merchantId,
            userId,
            type: PointTxnType.EARN,
            createdAt: { gte: today.from, lt: today.to },
          },
        }),
        this.prisma.order.count({
          where: {
            merchantId,
            userId,
            status: { not: 'CANCELED' },
            createdAt: { gte: today.from, lt: today.to },
            payAmount: amount,
          },
        }),
        this.prisma.pointAccount.findFirst({
          where: { userId },
          orderBy: { balance: 'desc' },
          select: { balance: true },
        }),
        this.prisma.couponInstance.count({
          where: {
            userId,
            status: CouponInstanceStatus.UNUSED,
            expireAt: { gte: now, lte: expiringBefore },
          },
        }),
      ]);

      return {
        pointsAvailable: account?.balance ?? 0,
        todayEarnCount,
        sameAmountToday,
        expiringCoupons,
      };
    } catch (e) {
      this.logger.warn(`会员上下文读取失败（不影响发分）：${(e as Error).message}`);
      return { pointsAvailable: 0, todayEarnCount: 0, sameAmountToday: 0, expiringCoupons: 0 };
    }
  }

  private buildRisks(
    plan: { blocked: boolean; reason: string | null; amount: number; points: number },
    ctx: EarnMemberContext,
  ): EarnRisk[] {
    const risks: EarnRisk[] = [];

    if (plan.blocked) {
      if (plan.reason) risks.push({ level: 'warn', text: plan.reason });
      return risks;
    }

    if (plan.amount >= LARGE_AMOUNT_YUAN) {
      risks.push({
        level: 'warn',
        text: `金额 ¥${fmt(plan.amount)} 明显高于日常客单，建议核对小票后再确认`,
      });
    }
    if (ctx.sameAmountToday > 0) {
      risks.push({
        level: 'warn',
        text: `今天已有 ${ctx.sameAmountToday} 笔 ¥${fmt(plan.amount)} 的消费记录，确认不是重复录单`,
      });
    }
    if (ctx.todayEarnCount >= REPEAT_EARN_HINT) {
      risks.push({
        level: 'info',
        text: `今天已为这位会员发过 ${ctx.todayEarnCount} 次积分，如为分单消费可忽略`,
      });
    }
    if (ctx.expiringCoupons > 0) {
      risks.push({
        level: 'info',
        text: `这位会员有 ${ctx.expiringCoupons} 张券 ${EXPIRING_COUPON_DAYS} 天内到期，可顺口提醒`,
      });
    }

    return risks;
  }

  private secret(): string {
    return process.env.AI_ASSIST_SECRET || process.env.JWT_SECRET || 'shangmeng-dev-secret';
  }

  private sign(payload: ProposalPayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const mac = createHmac('sha256', this.secret()).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  private verify(token: string): ProposalPayload {
    const [body, mac] = String(token).split('.');
    if (!body || !mac) {
      throw BizException.badRequest('PROPOSAL_INVALID', '发分建议已失效，请重新输入金额');
    }

    const expected = createHmac('sha256', this.secret()).update(body).digest('base64url');
    const got = Buffer.from(mac, 'utf8');
    const want = Buffer.from(expected, 'utf8');
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      throw BizException.badRequest('PROPOSAL_INVALID', '发分建议校验失败，请重新输入金额');
    }

    let payload: ProposalPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ProposalPayload;
    } catch {
      throw BizException.badRequest('PROPOSAL_INVALID', '发分建议已失效，请重新输入金额');
    }

    if (!payload || payload.v !== 1 || typeof payload.exp !== 'number') {
      throw BizException.badRequest('PROPOSAL_INVALID', '发分建议已失效，请重新输入金额');
    }
    if (payload.exp < Date.now()) {
      throw BizException.badRequest('PROPOSAL_EXPIRED', '发分建议已过期，请重新输入金额');
    }
    return payload;
  }
}

function fmt(n: number): string {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
