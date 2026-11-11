/** 口径常量：抽成一处，方便业务改数后全链路生效。 */
export const COUPON_TRAFFIC_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 流失会员：超过该天数未到店（有过订单） */
export const LOST_MEMBER_DAYS = 45;
/** 积分超发：当月发行积分面额 > 当月营收 × 该比例 */
export const POINTS_OVERISSUE_RATIO = 0.3;
/** 工具调用超时 */
export const TOOL_TIMEOUT_MS = 3000;
