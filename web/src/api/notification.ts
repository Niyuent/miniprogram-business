import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';

// ---------------------------------------------------- 枚举（与后端 prisma enum 一致）
export type ReadStatus = 'UNREAD' | 'READ';
export type NotificationType = 'SYSTEM' | 'AUDIT_RESULT' | 'AUTH_CHANGE' | 'ABNORMAL_ORDER' | 'SETTLEMENT';
export type NotifyLevel = 'NORMAL' | 'IMPORTANT' | 'URGENT';
export type NotificationTargetType = 'MERCHANT' | 'STORE' | 'ALL_MERCHANTS' | 'ALL_STORES';
export type ReceiverType = 'MERCHANT' | 'STORE' | 'USER';

/** 通知类型 / 级别 / 发布目标的中文标签（列表、铃铛、发件箱、发布弹窗共用） */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  SYSTEM: '系统通知',
  AUDIT_RESULT: '审核结果',
  AUTH_CHANGE: '授权变更',
  ABNORMAL_ORDER: '异常订单',
  SETTLEMENT: '对账单',
};
export const NOTIFY_LEVEL_LABELS: Record<NotifyLevel, string> = {
  NORMAL: '普通',
  IMPORTANT: '重要',
  URGENT: '紧急',
};
export const TARGET_TYPE_LABELS: Record<NotificationTargetType, string> = {
  MERCHANT: '指定附属商家',
  STORE: '指定门店',
  ALL_MERCHANTS: '全部附属商家',
  ALL_STORES: '全部门店',
};

export interface NotificationItem {
  id: number;
  receiverType: ReceiverType;
  receiverId: number;
  type: NotificationType;
  title: string;
  content: string;
  level: NotifyLevel;
  bizType: string | null;
  bizId: number | null;
  /** 发布人（admin_users.id）；S5.4-B1 起每次发送都写入 */
  senderId: number | null;
  /** 一次发送动作的批次号（UUID）；「全部发送」展开的 N 行共享同一值 */
  sendBatchId: string | null;
  /**
   * @deprecated S5.4-B1 起已读状态以 `notification_reads`（按登录账号）为准，本列已停写、
   * 仅为平滑回滚保留。展示请用 `alreadyRead`。
   */
  readStatus: ReadStatus;
  /** @deprecated 同上，展示请用 `alreadyRead` */
  readAt: string | null;
  createdAt: string;
  /** 当前登录账号是否已读 —— 后端按 notification_reads 计算，见下方 normalize() */
  alreadyRead: boolean;
}

/** 「我发过的通知」一行 = 一个发送批次（含展开行数与接收方种类数） */
export interface SentItem {
  sendBatchId: string;
  title: string;
  content: string;
  type: NotificationType;
  level: NotifyLevel;
  createdAt: string;
  /** 该批次展开的通知行数（= 实际接收方数量） */
  receiverCount: number;
  /** 接收方种类数（1 = 单一维度，如全部门店；>1 说明同批次混用） */
  receiverTypeCount: number;
}

/** 「某批发送」的一名收件人（S5.4-B2 新增接口 `GET /notifications/sent/:sendBatchId`） */
export interface SentBatchReceiver {
  receiverType: ReceiverType;
  receiverId: number;
  /** 商家 / 门店名称（后端已解析；目标已删时退化为 `商家 #id`） */
  name: string;
  code: string | null;
  /** 门店收件人所属商家 id；商家收件人为 null */
  merchantId: number | null;
}

/** 可选发布目标（与 POST /notifications 的 scope 校验同源） */
export interface NotificationTargets {
  merchants: Array<{ id: number; name: string; code: string | null }>;
  stores: Array<{ id: number; name: string; code: string | null; merchantId: number }>;
}

export interface QueryNotifications {
  page?: number;
  pageSize?: number;
  /** 传 UNREAD 只看未读；不传 = 全部 */
  readStatus?: ReadStatus;
  type?: NotificationType;
}

export interface QuerySent {
  page?: number;
  pageSize?: number;
  type?: NotificationType;
  /** 标题模糊搜索 */
  keyword?: string;
}

export interface SendNotification {
  targetType: NotificationTargetType;
  /** MERCHANT / STORE 时必填（≤200 个）；ALL_* 时不可传 */
  targetIds?: number[];
  title: string;
  content: string;
  type?: NotificationType;
  level?: NotifyLevel;
}

/**
 * 统一处理 `alreadyRead`
 *
 * 后端在两条链路都会返回该字段（列表项、单条已读的结果），这里统一收敛成
 * **必然为布尔值**，页面/组件不必到处写 `item.alreadyRead === true`，
 * 也避免后端漏字段时前端拿到 `undefined` 导致红点判断失效。
 */
function normalize<T extends { alreadyRead?: unknown }>(item: T): T & { alreadyRead: boolean } {
  return { ...item, alreadyRead: item.alreadyRead === true };
}

// ---------------------------------------------------------------- SSE（S7）
/** 事件名：与后端 `NOTIFICATION_NEW_EVENT` 保持一致 */
export const SSE_NOTIFICATION_NEW = 'notification:new';
/** 连接建立后的握手事件（服务端在流开头下发，用于判断「真的连上了」） */
export const SSE_CONNECTED = 'connected';

export interface SseTicket {
  ticket: string;
  /** 有效期（秒），默认 60 */
  expiresIn: number;
  connectUrl: string;
}

/**
 * SSE 长连接（S7）
 *
 * 为什么走 ticket 而不是直接带 JWT：`EventSource` **不支持自定义请求头**，
 * 无法携带 `Authorization`。所以先用 JWT 换一个 60 秒有效的一次性 ticket，
 * 再用 `?ticket=` 建流（ticket 用后即焚，不会长期留在 URL / 日志里）。
 */
export const notificationSse = {
  ticket() {
    return http<SseTicket>({ url: '/sse/ticket', method: 'POST' });
  },
  /** 建立长连接（调用方负责 close / 重连） */
  connect(ticket: string) {
    const base = import.meta.env.VITE_API_BASE || '/api/v1';
    return new EventSource(`${base}/sse/notifications?ticket=${encodeURIComponent(ticket)}`);
  },
};

/**
 * 站内信（S5.4-A 接收/发布 + S5.4-B1 每人各自已读 / 发送批次 / 我发过的 + S7 实时推送）
 *
 * 数据隔离一律由后端按 JWT 推导，本层**不接受任何 receiverId / merchantId 入参**。
 */
export const notificationApi = {
  /** 1. 我的通知列表（分页 + 未读/类型筛选；附带未读数，收件箱页可少发一次请求） */
  list(params: QueryNotifications = {}) {
    return http<PageResult<NotificationItem> & { unreadCount: number }>({
      url: '/notifications',
      method: 'GET',
      params,
    }).then((res) => ({ ...res, list: res.list.map(normalize) }));
  },

  /** 2. 我的未读数（铃铛 / 工作台共用同一口径） */
  unreadCount() {
    return http<{ unreadCount: number }>({ url: '/notifications/unread-count', method: 'GET' });
  },

  /** 3. 标记单条已读（幂等：已读再标返回 alreadyRead=true；不在接收范围 → 404） */
  markRead(id: number) {
    return http<NotificationItem>({ url: `/notifications/${id}/read`, method: 'PATCH' }).then(normalize);
  },

  /** 4. 我的通知全部标记已读（返回实际更新条数） */
  markAllRead() {
    return http<{ updated: number }>({ url: '/notifications/read-all', method: 'PATCH' });
  },

  /** 5. 发布通知（主体/平台 → 指定附属商家 / 指定门店 / 全部附属 / 全部门店） */
  send(data: SendNotification) {
    return http<{
      count: number;
      receiverType: ReceiverType;
      receiverIds: number[];
      type: NotificationType;
      level: NotifyLevel;
      title: string;
      sendBatchId: string;
    }>({ url: '/notifications', method: 'POST', data });
  },

  /** 6. 我发过的通知（按 sendBatchId 聚合，一次发送 = 一条） */
  sent(params: QuerySent = {}) {
    return http<PageResult<SentItem>>({ url: '/notifications/sent', method: 'GET', params });
  },

  /**
   * 6b. 某批发送的收件人明细（S5.4-B2：「发件箱 → 查看本批发给了谁」）
   * 仅能查自己发的批次；非本人 / 不存在 → 404（后端同样按 JWT 推导）。
   */
  receivers(sendBatchId: string) {
    return http<{ sendBatchId: string; receivers: SentBatchReceiver[] }>({
      url: `/notifications/sent/${encodeURIComponent(sendBatchId)}`,
      method: 'GET',
    });
  },

  /**
   * 7. 可选发布目标（本主体可发布的附属商家 + 其营业中门店）
   *
   * ⚠️ **刻意不做任何缓存**：每次打开发布弹窗都重新请求。
   *    `http` 层本身无缓存，后续若要加 useRequest / memo，请**跳过本接口** ——
   *    可发布范围可能因附属被停用等随时变化，缓存会出现「前端选得到 → 后端拒绝」。
   */
  targets() {
    return http<NotificationTargets>({ url: '/notifications/targets', method: 'GET' });
  },
};
