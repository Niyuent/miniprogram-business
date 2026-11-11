import { PlanPeriod, SubTier } from '@prisma/client';

/**
 * 计费口径的唯一来源。
 *
 * 价格、联盟上限、档位名称与标识色都集中在这里，避免出现
 * 「后端校验一套、小程序展示一套、后台对账又一套」的三份真理。
 * 前端需要的档位信息通过接口返回，不再各自硬编码色值。
 */

/** 各档位可加入的联盟数量上限 */
export const SUB_TIER_LIMIT: Record<SubTier, number> = {
  [SubTier.PRIMARY]: 2,
  [SubTier.ADVANCED]: 10,
};

export const SUB_TIER_NAME: Record<SubTier, string> = {
  [SubTier.PRIMARY]: '初级合作商',
  [SubTier.ADVANCED]: '高级合作商',
};

/**
 * 档位标识色：
 * - 初级 黄（#F5B301）
 * - 高级 亮紫（#A855F7）
 * 主体商家不使用档位色，以「盟主」金标区分，避免和初级黄撞色。
 */
export const SUB_TIER_COLOR: Record<SubTier, string> = {
  [SubTier.PRIMARY]: '#F5B301',
  [SubTier.ADVANCED]: '#A855F7',
};

/** 高级合作商：19.9 / 月 */
export const SUB_TIER_PRICE = 19.9;

/** 主体商家会员价格 */
export const MAIN_MEMBER_PRICE: Record<PlanPeriod, number> = {
  [PlanPeriod.MONTH]: 38.8,
  [PlanPeriod.QUARTER]: 109,
  [PlanPeriod.HALF_YEAR]: 209,
  [PlanPeriod.YEAR]: 418,
};

/** 各周期折算月数（续费顺延与到期计算都用它） */
export const PERIOD_MONTHS: Record<PlanPeriod, number> = {
  [PlanPeriod.MONTH]: 1,
  [PlanPeriod.QUARTER]: 3,
  [PlanPeriod.HALF_YEAR]: 6,
  [PlanPeriod.YEAR]: 12,
};

export const PERIOD_NAME: Record<PlanPeriod, string> = {
  [PlanPeriod.MONTH]: '月卡',
  [PlanPeriod.QUARTER]: '季卡',
  [PlanPeriod.HALF_YEAR]: '半年卡',
  [PlanPeriod.YEAR]: '年卡',
};

/**
 * 主体商家从未购买过会员时的试用期（自商家记录创建起算）。
 * 没有这条兜底，所有历史商家和种子数据会在功能上线当天集体停发。
 */
export const MAIN_MEMBER_TRIAL_DAYS = 30;

/** 按自然月顺延，并对月末做钳制（1/31 + 1 月 = 2/28，而不是滑到 3/3） */
export function addMonths(base: Date, months: number): Date {
  const d = new Date(base.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
