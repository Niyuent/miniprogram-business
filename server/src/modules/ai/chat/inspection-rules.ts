/**
 * 平台巡检异常判定（纯函数，便于单测）。
 * 异常由 SQL/聚合数字判定，模型只写简报。
 */

export interface InspectionSnapshot {
  merchantId: number;
  todayOrders: number;
  todayRedeems: number;
  /** 近 7 日日均核销 */
  avg7DayRedeems: number;
  /** 当日 00:00–05:00 核销占比 */
  nightRedeemRatio: number;
  /** 连续 7 天 0 订单 */
  zeroOrderDays7: boolean;
  /** 前 30 天（不含近 7 天）是否有单 */
  prior30HadOrders: boolean;
  /** 当日同一会员核销 ≥ 3 次的会员数 */
  repeatRedeemUsers: number;
  monthRevenue: number;
  monthPointsIssued: number;
  pointsOverissueRatio: number;
}

export type AbnormalRule =
  | '核销暴涨'
  | '深夜核销'
  | '零单流失'
  | '重复核销'
  | '积分超发';

export interface AbnormalFlag {
  rule: AbnormalRule;
  detail: string;
}

export function detectAbnormalFlags(s: InspectionSnapshot): AbnormalFlag[] {
  const flags: AbnormalFlag[] = [];

  if (s.todayRedeems >= 10 && s.avg7DayRedeems > 0 && s.todayRedeems >= s.avg7DayRedeems * 3) {
    flags.push({
      rule: '核销暴涨',
      detail: `当日核销 ${s.todayRedeems}，近7日均 ${s.avg7DayRedeems.toFixed(1)}`,
    });
  }

  if (s.todayRedeems >= 10 && s.nightRedeemRatio >= 0.6) {
    flags.push({
      rule: '深夜核销',
      detail: `当日核销 ${s.todayRedeems}，深夜占比 ${(s.nightRedeemRatio * 100).toFixed(0)}%`,
    });
  }

  if (s.zeroOrderDays7 && s.prior30HadOrders) {
    flags.push({
      rule: '零单流失',
      detail: '连续7天0订单，且前30天有单',
    });
  }

  if (s.repeatRedeemUsers > 0) {
    flags.push({
      rule: '重复核销',
      detail: `${s.repeatRedeemUsers} 位会员当日核销≥3次`,
    });
  }

  if (
    s.monthRevenue > 0 &&
    s.monthPointsIssued > s.monthRevenue * s.pointsOverissueRatio
  ) {
    flags.push({
      rule: '积分超发',
      detail: `当月积分发行 ${s.monthPointsIssued}，营收 ${s.monthRevenue.toFixed(0)}`,
    });
  }

  return flags;
}
