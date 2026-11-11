import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 业务异常：所有可预期的业务规则拒绝都走这里。
 * 前端可根据 data.reasonCode 做精细化提示。
 */
export class BizException extends HttpException {
  /**
   * @param extra 附加在响应 `data` 上的结构化信息。
   *   S2.3 的 `POST /redemptions/verify` 用它带上「券信息 + 逐项校验明细」——
   *   verify 既要按硬约束返回明确的 HTTP 状态（404/403/409），又要把券信息给前端展示，
   *   所以失败时是「带详情的异常」而不是「200 + redeemable=false」。
   */
  constructor(
    readonly reasonCode: string,
    message: string,
    httpStatus: HttpStatus = HttpStatus.BAD_REQUEST,
    extra?: Record<string, unknown>,
  ) {
    super(
      {
        code: httpStatus,
        message,
        reasonCode,
        ...(extra ?? {}),
      },
      httpStatus,
    );
  }

  static badRequest(reasonCode: string, message: string) {
    return new BizException(reasonCode, message, HttpStatus.BAD_REQUEST);
  }

  static forbidden(reasonCode: string, message: string) {
    return new BizException(reasonCode, message, HttpStatus.FORBIDDEN);
  }

  static notFound(reasonCode: string, message: string) {
    return new BizException(reasonCode, message, HttpStatus.NOT_FOUND);
  }

  static conflict(reasonCode: string, message: string) {
    return new BizException(reasonCode, message, HttpStatus.CONFLICT);
  }

  static unauthorized(reasonCode: string, message: string) {
    return new BizException(reasonCode, message, HttpStatus.UNAUTHORIZED);
  }

  static tooManyRequests(reasonCode: string, message: string) {
    return new BizException(reasonCode, message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** 业务原因码（对应 docs/04 硬约束） */
export const ReasonCode = {
  // H1 创建者必须是主体商家
  COUPON_CREATOR_NOT_MAIN: 'COUPON_CREATOR_NOT_MAIN',
  // H2 附属商家发券
  SUB_MERCHANT_NOT_AUTHORIZED: 'SUB_MERCHANT_NOT_AUTHORIZED',
  SUB_MERCHANT_CAN_ONLY_ISSUE_MAIN_COUPON: 'SUB_MERCHANT_CAN_ONLY_ISSUE_MAIN_COUPON',
  TEMPLATE_NOT_IN_AUTHORIZED_SCOPE: 'TEMPLATE_NOT_IN_AUTHORIZED_SCOPE',
  TEMPLATE_NOT_AVAILABLE: 'TEMPLATE_NOT_AVAILABLE',
  // H3 一单一券
  ORDER_COUPON_ALREADY_USED: 'ORDER_COUPON_ALREADY_USED',
  // H5 核销前置校验
  CODE_NOT_FOUND: 'CODE_NOT_FOUND',
  CODE_NOT_ISSUED: 'CODE_NOT_ISSUED',
  COUPON_NOT_BELONG_TO_USER: 'COUPON_NOT_BELONG_TO_USER',
  COUPON_ALREADY_USED: 'COUPON_ALREADY_USED',
  COUPON_EXPIRED: 'COUPON_EXPIRED',
  COUPON_FROZEN: 'COUPON_FROZEN',
  TEMPLATE_NOT_PUBLISHED: 'TEMPLATE_NOT_PUBLISHED',
  STORE_NOT_IN_SCOPE: 'STORE_NOT_IN_SCOPE',
  THRESHOLD_NOT_MET: 'THRESHOLD_NOT_MET',
  /** 核销：商家开启「实付必须大于面值」时订单金额不足 */
  REQUIRE_GREATER_THAN_FACE: 'REQUIRE_GREATER_THAN_FACE',
  /** 核销：商品不在适用/排除范围内 */
  PRODUCT_NOT_IN_SCOPE: 'PRODUCT_NOT_IN_SCOPE',
  /** 兑换：仅限新客，但用户已有历史订单 */
  NEW_CUSTOMER_ONLY: 'NEW_CUSTOMER_ONLY',
  /** 兑换：已过发放截止日期 */
  ISSUE_DEADLINE_PASSED: 'ISSUE_DEADLINE_PASSED',
  // H6 数据隔离
  STORE_NOT_OWNED: 'STORE_NOT_OWNED',
  FORBIDDEN_SCOPE: 'FORBIDDEN_SCOPE',
  SCOPE_NOT_READY: 'SCOPE_NOT_READY',
  // S1 鉴权
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  MERCHANT_SUSPENDED: 'MERCHANT_SUSPENDED',
  MERCHANT_NOT_PENDING: 'MERCHANT_NOT_PENDING',
  MERCHANT_NOT_ACTIVE: 'MERCHANT_NOT_ACTIVE',
  MERCHANT_ID_REQUIRED: 'MERCHANT_ID_REQUIRED',
  ROLE_NOT_ALLOWED: 'ROLE_NOT_ALLOWED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PASSWORD_MISMATCH: 'PASSWORD_MISMATCH',
  PASSWORD_TOO_WEAK: 'PASSWORD_TOO_WEAK',
  // 系统生成的账号首次登录必须改密，未改密前拒绝其他接口
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  // 限流
  RATE_LIMITED: 'RATE_LIMITED',
  // 上传：类型不支持 / 魔数与声明不符
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  // S1.3 授权管理
  AUTHORIZATION_EXISTS: 'AUTHORIZATION_EXISTS',
  AUTHORIZATION_MAIN_INVALID: 'AUTHORIZATION_MAIN_INVALID',
  AUTHORIZATION_NOT_SUB: 'AUTHORIZATION_NOT_SUB',
  AUTHORIZATION_NOT_CHILD: 'AUTHORIZATION_NOT_CHILD',
  TEMPLATE_NOT_MAIN_COUPON: 'TEMPLATE_NOT_MAIN_COUPON',
  TEMPLATE_SCOPE_REQUIRED: 'TEMPLATE_SCOPE_REQUIRED',
  // S2.1 券模板管理
  // 已上架的模板不允许直接编辑（必须先下架），VOID 不可再操作
  TEMPLATE_NOT_EDITABLE: 'TEMPLATE_NOT_EDITABLE',
  TEMPLATE_ALREADY_PUBLISHED: 'TEMPLATE_ALREADY_PUBLISHED',
  // public 重复上架 / 重复下架
  TEMPLATE_INVALID_VALID_PERIOD: 'TEMPLATE_INVALID_VALID_PERIOD',
  // 适用范围：S2.1 只实现 ALL_STORES / SPECIFIED_STORES
  APPLY_SCOPE_UNSUPPORTED: 'APPLY_SCOPE_UNSUPPORTED',
  TEMPLATE_STORE_REQUIRED: 'TEMPLATE_STORE_REQUIRED',
  // 调整库存不能低于已发放数量，防止库存与已发券实例对不上
  STOCK_BELOW_ISSUED: 'STOCK_BELOW_ISSUED',
  // 模板有有效的附属归属时必须挂在自己主体下
  OWNER_NOT_CHILD: 'OWNER_NOT_CHILD',
  // S2.3 核销
  // 一单一券：订单已绑定其他券 / 并发绑定失败（orders.couponInstanceId 唯一索引兜底）
  ORDER_ALREADY_HAS_COUPON: 'ORDER_ALREADY_HAS_COUPON',
  // 冲正：只有 SUCCESS 记录可冲正，重复冲正拒绝
  REDEMPTION_ALREADY_REVERSED: 'REDEMPTION_ALREADY_REVERSED',
  // 冲正超窗：附属 / 店员只能冲正 24 小时内的记录，超时需主体商家操作
  REVERSE_WINDOW_EXPIRED: 'REVERSE_WINDOW_EXPIRED',
  // 小程序会员码票据过期 / 无效（5 分钟短时效，防截图盗刷）
  MEMBER_QR_EXPIRED: 'MEMBER_QR_EXPIRED',
  // 核销 / 校验必须明确门店（店员未绑门店且未传 storeId）
  STORE_REQUIRED: 'STORE_REQUIRED',
  // S2.2 券码预生成 + 券实例发放
  // 同 templateId + batchNo 重复生成（coupon_code_batches.batchNo 唯一约束命中）
  BATCH_ALREADY_EXISTS: 'BATCH_ALREADY_EXISTS',
  // 库存不足：issued_count + 数量 > total_stock（条件更新影响行数 0）
  STOCK_EXHAUSTED: 'STOCK_EXHAUSTED',
  // 券码池耗尽：未发放券码不足本次发放数量
  CODE_POOL_EXHAUSTED: 'CODE_POOL_EXHAUSTED',
  // 冻结 / 解冻的目标状态不合法（已核销、已过期不能冻）
  COUPON_NOT_FREEZABLE: 'COUPON_NOT_FREEZABLE',
  // S3.1 积分
  // 积分账户乐观锁：重试 3 次仍拿不到行（并发写冲突）→ 409，而不是把更新悄悄丢了
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
  // 同一订单重复送积分（唯一索引 (relatedOrderId, type) 兜底）→ 409，防「双倍积分」漏洞
  ORDER_POINTS_ALREADY_EARNED: 'ORDER_POINTS_ALREADY_EARNED',
  // 找不到生效中的积分规则（商家级 / 平台级都没有）
  POINT_RULE_NOT_FOUND: 'POINT_RULE_NOT_FOUND',
  // 同一商家已有一条生效规则（point_rules 唯一约束 (merchantId, status)）
  POINT_RULE_ALREADY_ACTIVE: 'POINT_RULE_ALREADY_ACTIVE',
  // 积分账户不存在（该用户还没有任何积分流水）
  POINT_ACCOUNT_NOT_FOUND: 'POINT_ACCOUNT_NOT_FOUND',
  // 多联盟：发分必须指定联盟；商家不属于该联盟
  ALLIANCE_ID_REQUIRED: 'ALLIANCE_ID_REQUIRED',
  ALLIANCE_NOT_FOUND: 'ALLIANCE_NOT_FOUND',
  MERCHANT_NOT_IN_ALLIANCE: 'MERCHANT_NOT_IN_ALLIANCE',
  // 消费录单送积分必须带订单（无订单则「一单只送一次积分」的唯一索引无从生效）
  ORDER_ID_REQUIRED: 'ORDER_ID_REQUIRED',
  // S3.2 积分兑换
  // 单个用户在某模板上的兑换次数已达 perUserLimit
  PER_USER_LIMIT_EXCEEDED: 'PER_USER_LIMIT_EXCEEDED',
  // 模板未设置兑换所需积分（pointsCost<=0），不支持积分兑换
  TEMPLATE_NOT_EXCHANGEABLE: 'TEMPLATE_NOT_EXCHANGEABLE',
  // 可用积分不足：含「有余额但批次已过期」这种情况（过期积分不能花）
  BALANCE_NOT_ENOUGH: 'BALANCE_NOT_ENOUGH',
  // 多联盟交叉：附属券只能用主体消费获得的积分（sourceRole=MAIN）兑换
  SUB_COUPON_REQUIRES_MAIN_POINTS: 'SUB_COUPON_REQUIRES_MAIN_POINTS',
  // 兑换指定的 allianceId 与券模板所属联盟不一致
  ALLIANCE_MISMATCH: 'ALLIANCE_MISMATCH',
  // 人工调整金额非法（0 / 正向调整超出上限）
  INVALID_ADJUST_AMOUNT: 'INVALID_ADJUST_AMOUNT',
  // S3.4 订单管理 / 异常订单处理
  // 订单状态不是 ABNORMAL（只有异常订单才能处理 / 只有正常订单才能标记异常）
  ORDER_NOT_ABNORMAL: 'ORDER_NOT_ABNORMAL',
  // 订单已被处理过（并发两个 admin 处理同一异常订单，后到者撞条件更新 → 409）
  ORDER_ALREADY_HANDLED: 'ORDER_ALREADY_HANDLED',
  // 异常处理类型不合法（只支持 CANCEL / AMOUNT_ERROR / DISPUTE 三种）
  ORDER_HANDLE_TYPE_INVALID: 'ORDER_HANDLE_TYPE_INVALID',
  // 订单当前没有绑定券，或券不是 USED 状态，无法执行「券回退」
  ORDER_COUPON_NOT_REFUNDABLE: 'ORDER_COUPON_NOT_REFUNDABLE',
  // 异常订单处理权归主体（附属只能标记，不能处理）
  ORDER_HANDLE_FORBIDDEN: 'ORDER_HANDLE_FORBIDDEN',
  // S4.2 对账账单
  // 同 (merchantId, period) 已存在且非 DISPUTED，幂等返回已存在（不重复创建）
  SETTLEMENT_ALREADY_EXISTS: 'SETTLEMENT_ALREADY_EXISTS',
  // S5.2 用户管理：手机号被占用（手机号全局唯一）
  USER_PHONE_EXISTS: 'USER_PHONE_EXISTS',
  // S5.3 门店变更：同一门店已存在待审核申请
  STORE_CHANGE_PENDING_EXISTS: 'STORE_CHANGE_PENDING_EXISTS',
  // S5.3 门店变更：申请非 PENDING（已审核/已作废，不可再操作）
  STORE_CHANGE_NOT_PENDING: 'STORE_CHANGE_NOT_PENDING',
  // S5.3 门店变更：夹带禁止变更字段（code / merchantId / status 等）
  STORE_CHANGE_FIELD_FORBIDDEN: 'STORE_CHANGE_FIELD_FORBIDDEN',
  // S5.3 门店变更：提交内容与当前值完全一致（无有效变更）
  STORE_CHANGE_NO_DIFF: 'STORE_CHANGE_NO_DIFF',
  // S5.3 门店变更：驳回未填写原因
  STORE_CHANGE_REASON_REQUIRED: 'STORE_CHANGE_REASON_REQUIRED',
  // S5.4-A 站内信：targetType=MERCHANT/STORE 未传 targetIds
  NOTIFICATION_TARGET_REQUIRED: 'NOTIFICATION_TARGET_REQUIRED',
  // S5.4-A 站内信：targetType=ALL_* 却传了 targetIds（不做静默忽略）
  NOTIFICATION_TARGET_INVALID: 'NOTIFICATION_TARGET_INVALID',
  // S5.4-A 站内信：按目标展开后没有任何接收方
  NOTIFICATION_NO_RECEIVER: 'NOTIFICATION_NO_RECEIVER',
  // CONFIRMED 后冻结，不可再 confirm/dispute
  SETTLEMENT_FROZEN: 'SETTLEMENT_FROZEN',
  // 非 GENERATED 状态不能 confirm/dispute（如 DISPUTED 必须先重新生成）
  SETTLEMENT_NOT_CONFIRMABLE: 'SETTLEMENT_NOT_CONFIRMABLE',
  // 提异议必填原因
  SETTLEMENT_DISPUTE_REASON_REQUIRED: 'SETTLEMENT_DISPUTE_REASON_REQUIRED',
  // 通用
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  INSUFFICIENT_POINTS: 'INSUFFICIENT_POINTS',
  STOCK_NOT_ENOUGH: 'STOCK_NOT_ENOUGH',
  // 计费：档位与会员
  // 附属商家可加入的联盟数量已达当前档位上限（初级 2 / 高级 10）
  ALLIANCE_LIMIT_REACHED: 'ALLIANCE_LIMIT_REACHED',
  // 盟主会员到期：联盟内发分/发券已停
  MAIN_MEMBER_EXPIRED: 'MAIN_MEMBER_EXPIRED',
  // 商家已是该联盟成员
  ALLIANCE_ALREADY_JOINED: 'ALLIANCE_ALREADY_JOINED',
  // 盟主不能以附属身份加入自己的联盟
  ALLIANCE_SELF_JOIN: 'ALLIANCE_SELF_JOIN',
  // 盟主不能退出自己的联盟（需先转移或解散）
  ALLIANCE_MAIN_CANNOT_QUIT: 'ALLIANCE_MAIN_CANNOT_QUIT',
  // 订阅单不存在
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  // 订阅单非 PENDING（已确认/已取消），不可重复操作
  SUBSCRIPTION_NOT_PENDING: 'SUBSCRIPTION_NOT_PENDING',
  // 商家互结清分：账期格式非法
  CLEARING_PERIOD_INVALID: 'CLEARING_PERIOD_INVALID',
  // 商家互结清分：账期已关闭或已有账单结算，不允许重算
  CLEARING_PERIOD_FROZEN: 'CLEARING_PERIOD_FROZEN',
  // 商家互结清分：账单不存在或无权查看
  CLEARING_BILL_NOT_FOUND: 'CLEARING_BILL_NOT_FOUND',
} as const;
