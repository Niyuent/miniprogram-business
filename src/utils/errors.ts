import { HttpError } from '@/utils/request';

const REASON: Record<string, string> = {
  CODE_NOT_FOUND: '没有这张券，请核对券码',
  CODE_NOT_ISSUED: '这张券还没发给顾客',
  COUPON_ALREADY_USED: '这张券已经用过了',
  COUPON_EXPIRED: '这张券已经过期',
  COUPON_FROZEN: '这张券已冻结，不能核销',
  TEMPLATE_NOT_AVAILABLE: '这张券当前不可用',
  TEMPLATE_NOT_PUBLISHED: '这张券还没上架',
  THRESHOLD_NOT_MET: '订单金额没有达到用券门槛',
  ORDER_ALREADY_HAS_COUPON: '这笔订单已经用过一张券',
  COUPON_NOT_BELONG_TO_USER: '这张券不属于这笔订单的顾客',
  STORE_NOT_OWNED: '当前门店不能核销这张券',
  STORE_NOT_IN_SCOPE: '当前门店不在这张券的使用范围',
  STORE_REQUIRED: '还没有可用的核销门店',
  PERMISSION_DENIED: '当前账号没有这项权限',
  FORBIDDEN_SCOPE: '当前账号不能做这个操作',
  ORDER_POINTS_ALREADY_EARNED: '这笔消费已经发过积分',
  ORDER_ID_REQUIRED: '缺少订单，暂时不能发积分',
  RESOURCE_NOT_FOUND: '没有找到对应的顾客或订单',
  BELOW_MIN_AMOUNT: '金额太小，这次不发积分',
  POINTS_ZERO: '按当前规则折算后没有积分',
  BALANCE_NOT_ENOUGH: '积分不够哦',
  PER_USER_LIMIT_EXCEEDED: '这张券你已经领过了',
  STOCK_EXHAUSTED: '这张券已经被领完了',
  TEMPLATE_NOT_EXCHANGEABLE: '这张券现在不能用积分换',
  POINT_ACCOUNT_NOT_FOUND: '还没有积分账户',
};

/** 用 reasonCode 给店员看的句子，不把接口原文直接弹出来。 */
export function friendlyMessage(error: unknown, fallback = '操作没有成功，请稍后再试'): string {
  if (error instanceof HttpError) {
    if (error.reasonCode && REASON[error.reasonCode]) return REASON[error.reasonCode];
    if (error.status === 0) return '网络不通，请检查连接后再试';
    if (error.status === 401) return '登录已失效，请重新登录';
    if (error.status === 403) return '当前账号不能做这个操作';
    if (error.status === 404) return '没有找到要处理的数据';
  }
  return fallback;
}
