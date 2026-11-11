import { request } from '@/utils/request';

export interface EarnRisk {
  level: 'warn' | 'info';
  text: string;
}

export interface EarnMemberContext {
  pointsAvailable: number;
  todayEarnCount: number;
  sameAmountToday: number;
  expiringCoupons: number;
}

export interface EarnProposal {
  /** 服务端签名票据，10 分钟有效，前端不可构造 */
  token: string;
  proposalId: string;
  allianceId: number;
  allianceName: string;
  amount: number;
  points: number;
  earnRatio: number;
  minAmount: number;
  pointsValidMonths: number;
  blocked: boolean;
  reasonCode: string | null;
  reason: string | null;
  suggestion: string;
  member: EarnMemberContext;
  risks: EarnRisk[];
  expiresIn: number;
}

export interface EarnConfirmResult {
  earned: boolean;
  points: number;
  allianceId?: number;
  allianceName?: string;
  message?: string;
  reasonCode?: string;
  /** 建议时的分值，用于核对「说的和发的一致」 */
  proposalPoints?: number;
  /** true 表示这笔此前已发放过，本次未重复入账 */
  idempotent?: boolean;
}

/**
 * AI 协同发分第一步：只要建议，不入账。
 *
 * 积分由后端规则引擎算出，前端不参与计算——这样「建议发多少」和「实际发多少」永远一致。
 */
export function proposeEarn(body: {
  userId: number;
  amount: number;
  allianceId: number;
  storeId?: number | null;
}) {
  return request<EarnProposal>({
    url: '/ai/assist/earn/propose',
    method: 'POST',
    data: {
      userId: body.userId,
      amount: body.amount,
      allianceId: body.allianceId,
      ...(body.storeId ? { storeId: body.storeId } : {}),
    },
    redirectOn401: false,
  });
}

/** AI 协同发分第二步：凭票据确认入账。同一票据重复调用返回首次结果，不会重复发分。 */
export function confirmEarn(token: string) {
  return request<EarnConfirmResult>({
    url: '/ai/assist/earn/confirm',
    method: 'POST',
    data: { token },
    redirectOn401: false,
  });
}
