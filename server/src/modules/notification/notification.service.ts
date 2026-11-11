import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  MerchantStatus,
  MerchantType,
  NotificationType,
  NotifyLevel,
  Prisma,
  ReadStatus,
  ReceiverType,
  StoreStatus,
} from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import { SseService } from '../sse/sse.service';
import { QueryNotificationDto, QuerySentNotificationDto, SendNotificationDto } from './dto/notification.dto';

/** SSE 事件名（S7）：前端 EventSource 监听同名事件 */
export const NOTIFICATION_NEW_EVENT = 'notification:new';

/**
 * 站内信（S5.4-A 接收/发布 + S5.4-B1 每人各自已读、发送人、我发过的）
 *
 * 接收侧隔离（receiverType + receiverId 双维度，一律由 JWT 推导）：
 *  - 店员           = (STORE, 本门店)
 *  - 主体 / 附属商家 = (MERCHANT, 本商家) ∪ (STORE, 本商家旗下门店)
 *  - 平台账号        = (PLATFORM, *) —— 用于 AI 巡检等系统告警
 * 不在接收身份内的通知一律 404（不泄露存在性）。
 *
 * 已读口径（S5.4-B1）：`notification_reads(notificationId, adminUserId)` —— **按登录账号**记，
 * 同一门店通知下店员与附属管理员互不影响；`notifications.readStatus/readAt` 已停写（deprecated，仅供回滚）。
 *
 * 发布侧：仅平台 / 主体（`notification:send` + 本服务二次断言），
 * 目标只能是本主体直属附属商家及其门店（平台 = 全部附属）。
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger('Notification');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /** S7：发布后实时推送（事务提交后调用） */
    private readonly sse: SseService,
  ) {}

  private async receiverWhere(user: JwtPayload): Promise<Prisma.NotificationWhereInput | null> {
    if (user.userType === 'PLATFORM') {
      return { receiverType: ReceiverType.PLATFORM };
    }
    if (user.userType === 'STORE') {
      return user.storeId ? { receiverType: ReceiverType.STORE, receiverId: user.storeId } : null;
    }
    if (user.userType !== 'MERCHANT' || !user.merchantId) return null;

    const stores = await this.prisma.store.findMany({
      where: { merchantId: user.merchantId },
      select: { id: true },
    });
    const or: Prisma.NotificationWhereInput[] = [
      { receiverType: ReceiverType.MERCHANT, receiverId: user.merchantId },
    ];
    if (stores.length) {
      or.push({ receiverType: ReceiverType.STORE, receiverId: { in: stores.map((s) => s.id) } });
    }
    return { OR: or };
  }

  /** 未读条件（按登录账号）：接收范围 ∩ 尚无我的阅读记录 */
  private unreadWhere(mine: Prisma.NotificationWhereInput, adminUserId: number): Prisma.NotificationWhereInput {
    return { AND: [mine, { reads: { none: { adminUserId } } }] };
  }

  /** 统一出口：把「本条是否已被当前账号读过」暴露为 alreadyRead / readStatus / readAt */
  private withReadState<T extends { reads?: Array<{ readAt: Date }> }>(row: T) {
    const { reads, ...rest } = row;
    const readAt = reads?.[0]?.readAt ?? null;
    return {
      ...rest,
      readStatus: readAt ? ReadStatus.READ : ReadStatus.UNREAD,
      readAt,
      alreadyRead: readAt !== null,
    };
  }

  private readInclude(adminUserId: number) {
    return { reads: { where: { adminUserId }, select: { readAt: true } } } as const;
  }

  /** 发布方可触达的附属商家范围；附属 / 店员 → 403 */
  private async senderMerchantScope(user: JwtPayload): Promise<Prisma.MerchantWhereInput> {
    if (user.userType === 'PLATFORM') return { type: MerchantType.SUB };
    if (user.userType === 'MERCHANT' && user.merchantId) {
      const me = await this.prisma.merchant.findUnique({
        where: { id: user.merchantId },
        select: { type: true },
      });
      if (me?.type === MerchantType.MAIN) return { type: MerchantType.SUB, parentId: user.merchantId };
    }
    throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '通知由主体商家发布');
  }

  private requireIds(dto: SendNotificationDto): number[] {
    if (!dto.targetIds?.length) {
      throw BizException.badRequest(
        ReasonCode.NOTIFICATION_TARGET_REQUIRED,
        `targetType=${dto.targetType} 时必须传 targetIds`,
      );
    }
    return [...new Set(dto.targetIds)];
  }

  private async resolveReceivers(
    dto: SendNotificationDto,
    scope: Prisma.MerchantWhereInput,
  ): Promise<{ receiverType: ReceiverType; receiverIds: number[] }> {
    if ((dto.targetType === 'ALL_MERCHANTS' || dto.targetType === 'ALL_STORES') && dto.targetIds?.length) {
      throw BizException.badRequest(
        ReasonCode.NOTIFICATION_TARGET_INVALID,
        `targetType=${dto.targetType} 时不可传 targetIds`,
      );
    }

    switch (dto.targetType) {
      case 'MERCHANT': {
        const ids = this.requireIds(dto);
        const rows = await this.prisma.merchant.findMany({
          where: { AND: [scope, { id: { in: ids } }] },
          select: { id: true },
        });
        const found = new Set(rows.map((r) => r.id));
        const missing = ids.filter((id) => !found.has(id));
        if (missing.length) {
          throw BizException.forbidden(
            ReasonCode.FORBIDDEN_SCOPE,
            `以下商家不在可发布范围内：${missing.join(', ')}`,
          );
        }
        return { receiverType: ReceiverType.MERCHANT, receiverIds: ids };
      }
      case 'STORE': {
        const ids = this.requireIds(dto);
        const rows = await this.prisma.store.findMany({
          where: { id: { in: ids }, merchant: scope },
          select: { id: true },
        });
        const found = new Set(rows.map((r) => r.id));
        const missing = ids.filter((id) => !found.has(id));
        if (missing.length) {
          throw BizException.forbidden(
            ReasonCode.STORE_NOT_OWNED,
            `以下门店不在可发布范围内：${missing.join(', ')}`,
          );
        }
        return { receiverType: ReceiverType.STORE, receiverIds: ids };
      }
      case 'ALL_MERCHANTS': {
        const rows = await this.prisma.merchant.findMany({
          where: { AND: [scope, { status: MerchantStatus.APPROVED }] },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        return { receiverType: ReceiverType.MERCHANT, receiverIds: rows.map((r) => r.id) };
      }
      case 'ALL_STORES': {
        const rows = await this.prisma.store.findMany({
          where: {
            status: StoreStatus.OPEN,
            merchant: { AND: [scope, { status: MerchantStatus.APPROVED }] },
          },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        return { receiverType: ReceiverType.STORE, receiverIds: rows.map((r) => r.id) };
      }
    }
  }

  // ---------------------------------------------------------------- 接收侧

  async list(query: QueryNotificationDto, user: JwtPayload) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const mine = await this.receiverWhere(user);
    if (!mine) return { list: [], total: 0, page, pageSize, unreadCount: 0 };

    const uid = user.sub;
    const where: Prisma.NotificationWhereInput = {
      AND: [
        mine,
        query.readStatus === ReadStatus.UNREAD
          ? { reads: { none: { adminUserId: uid } } }
          : query.readStatus === ReadStatus.READ
            ? { reads: { some: { adminUserId: uid } } }
            : {},
        query.type ? { type: query.type } : {},
      ],
    };

    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.readInclude(uid),
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: this.unreadWhere(mine, uid) }),
    ]);

    return { list: rows.map((r) => this.withReadState(r)), total, page, pageSize, unreadCount };
  }

  /** 未读数（供工作台等复用，口径唯一） */
  async getUnreadCount(user: JwtPayload): Promise<number> {
    const mine = await this.receiverWhere(user);
    if (!mine) return 0;
    return this.prisma.notification.count({ where: this.unreadWhere(mine, user.sub) });
  }

  async unreadCount(user: JwtPayload) {
    return { unreadCount: await this.getUnreadCount(user) };
  }

  /** 已读幂等：重复标记返回 200 + alreadyRead=true；不在接收范围 → 404 */
  async markRead(id: number, user: JwtPayload) {
    const mine = await this.receiverWhere(user);
    if (!mine) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '通知不存在');
    const uid = user.sub;

    const exists = await this.prisma.notification.findFirst({
      where: { AND: [mine, { id }] },
      select: { id: true },
    });
    if (!exists) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '通知不存在');

    const { count } = await this.prisma.notificationRead.createMany({
      data: [{ notificationId: id, adminUserId: uid }],
      skipDuplicates: true,
    });

    const row = await this.prisma.notification.findUniqueOrThrow({
      where: { id },
      include: this.readInclude(uid),
    });
    // 修复（S5.4-B2 验收发现）：此前写成 `alreadyRead: count === 0` —— 语义完全颠倒
    // （首次标记 count=1 反而返回 false，重复标记 count=0 才返回 true）。
    // withReadState 已在 create 之后重查 read 记录，本身就是权威口径，直接返回即可。
    return this.withReadState(row);
  }

  async markAllRead(user: JwtPayload) {
    const mine = await this.receiverWhere(user);
    if (!mine) return { updated: 0 };
    const uid = user.sub;

    const targets = await this.prisma.notification.findMany({
      where: this.unreadWhere(mine, uid),
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (!targets.length) return { updated: 0 };

    let updated = 0;
    const CHUNK = 500;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const { count } = await this.prisma.notificationRead.createMany({
        data: targets.slice(i, i + CHUNK).map((t) => ({ notificationId: t.id, adminUserId: uid })),
        skipDuplicates: true,
      });
      updated += count;
    }
    return { updated };
  }

  // ---------------------------------------------------------------- 发布侧

  async send(dto: SendNotificationDto, user: JwtPayload, ip?: string, ua?: string) {
    const scope = await this.senderMerchantScope(user);
    const { receiverType, receiverIds } = await this.resolveReceivers(dto, scope);
    if (!receiverIds.length) {
      throw BizException.badRequest(ReasonCode.NOTIFICATION_NO_RECEIVER, '没有符合条件的接收方');
    }

    const type = dto.type ?? NotificationType.SYSTEM;
    const level = dto.level ?? NotifyLevel.NORMAL;
    // 一次发送 = 一个批次；「全部发送」展开的 N 行共享它，「我发过的通知」据此聚合
    const sendBatchId = randomUUID();

    const result = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.notification.createMany({
        data: receiverIds.map((receiverId) => ({
          receiverType,
          receiverId,
          type,
          level,
          title: dto.title,
          content: dto.content,
          senderId: user.sub,
          sendBatchId,
        })),
      });

      // S7：查回本批次新建的行（createMany 不返回 id），供事务提交后做 SSE 推送
      const rows = await tx.notification.findMany({
        where: { sendBatchId },
        select: { id: true, receiverType: true, receiverId: true, title: true, content: true, type: true, level: true, createdAt: true },
        orderBy: { id: 'asc' },
      });

      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'notification',
          action: 'notification:send',
          targetType: 'notification',
          after: {
            targetType: dto.targetType,
            receiverType,
            receiverIds,
            count,
            type,
            level,
            title: dto.title,
            sendBatchId,
          },
          ip,
          userAgent: ua,
        },
        tx,
      );

      return { count, rows, receiverType, receiverIds, type, level, title: dto.title, sendBatchId };
    });

    // 推送放在事务**提交之后**：避免事务回滚时前端已经收到「不存在的通知」
    await this.pushNewNotifications(result.rows, result.receiverType);

    const { rows: _rows, ...response } = result;
    return response;
  }

  /**
   * 系统通知（经营日报等没有登录用户的场景）。
   *
   * 不走 `send()`：那条路径的发布范围只有「主体的直属附属」，主体商家自己会被 403。
   * 写入、审计、事务提交后再 SSE，与 `send()` 相同。
   */
  async deliverSystem(input: {
    receiverType: ReceiverType;
    receiverId: number;
    title: string;
    content: string;
    level?: NotifyLevel;
    bizType?: string;
    bizId?: number;
    type?: NotificationType;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const row = await tx.notification.create({
        data: {
          receiverType: input.receiverType,
          receiverId: input.receiverId,
          type: input.type ?? NotificationType.SYSTEM,
          level: input.level ?? NotifyLevel.NORMAL,
          title: input.title,
          content: input.content,
          bizType: input.bizType ?? null,
          bizId: input.bizId ?? null,
          senderId: null,
          sendBatchId: randomUUID(),
        },
        select: {
          id: true,
          receiverType: true,
          receiverId: true,
          title: true,
          content: true,
          type: true,
          level: true,
          createdAt: true,
        },
      });
      await this.audit.record(
        {
          operatorId: null,
          operatorType: 'SYSTEM',
          operatorName: 'system',
          module: 'notification',
          action: 'notification:send',
          targetType: 'notification',
          targetId: row.id,
          after: { bizType: input.bizType ?? null, receiverType: input.receiverType, receiverId: input.receiverId, title: input.title },
          ip: null,
          userAgent: 'ai-daily-report',
        },
        tx,
      );
      return row;
    });

    await this.pushNewNotifications([result], result.receiverType);
    return { id: result.id };
  }

  /**
   * 实时推送新通知（S7）
   *
   * 按通知的接收维度选 target：
   *  - MERCHANT：`{ merchantId }` → 该商家管理员 + 其所有门店店员（他们都能看到商家级通知）
   *  - STORE：`{ merchantId(门店所属商家), storeId }` → **仅该门店店员** + 该商家管理员
   *    （只用 merchantId 会误伤同商家其它门店的店员）
   *
   * 推送失败不影响发布结果：广播内部已逐个 try/catch，断开的连接会被清理。
   */
  private async pushNewNotifications(
    rows: Array<{
      id: number;
      receiverType: ReceiverType;
      receiverId: number;
      title: string;
      content: string;
      type: NotificationType;
      level: NotifyLevel;
      createdAt: Date;
    }>,
    receiverType: ReceiverType,
  ) {
    if (!rows.length) return;

    const payloadOf = (r: (typeof rows)[number]) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      level: r.level,
      type: r.type,
      createdAt: r.createdAt.toISOString(),
    });

    if (receiverType === ReceiverType.MERCHANT) {
      for (const row of rows) {
        this.sse.broadcast(NOTIFICATION_NEW_EVENT, payloadOf(row), { merchantId: row.receiverId });
      }
      return;
    }

    if (receiverType === ReceiverType.PLATFORM) {
      for (const row of rows) {
        this.sse.broadcast(NOTIFICATION_NEW_EVENT, payloadOf(row), { platform: true });
      }
      return;
    }

    // STORE：解析每个门店的所属商家，才能把「该商家管理员」也纳入推送范围
    const stores = await this.prisma.store.findMany({
      where: { id: { in: rows.map((r) => r.receiverId) } },
      select: { id: true, merchantId: true },
    });
    const ownerOf = new Map(stores.map((s) => [s.id, s.merchantId]));
    for (const row of rows) {
      const merchantId = ownerOf.get(row.receiverId);
      this.sse.broadcast(
        NOTIFICATION_NEW_EVENT,
        payloadOf(row),
        merchantId === undefined ? { storeId: row.receiverId } : { merchantId, storeId: row.receiverId },
      );
    }
  }

  /**
   * 我发过的通知（按发送批次聚合，一次发送一行）
   *
   * 用 `sendBatchId` 而非「标题 + 秒级时间」聚合：后者会把同一秒内的两次同名发送误合并成一条。
   */
  async listSent(query: QuerySentNotificationDto, user: JwtPayload) {
    await this.senderMerchantScope(user); // 仅平台/主体可发布 → 也仅其可查「我发过的」

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const conds: Prisma.Sql[] = [Prisma.sql`senderId = ${user.sub}`, Prisma.sql`sendBatchId IS NOT NULL`];
    if (query.type) conds.push(Prisma.sql`type = ${query.type}`);
    if (query.keyword) conds.push(Prisma.sql`title LIKE ${`%${query.keyword}%`}`);
    const whereSql = Prisma.join(conds, ' AND ');

    const [totalRow] = await this.prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT COUNT(DISTINCT sendBatchId) AS total FROM notifications WHERE ${whereSql}`,
    );

    const rows = await this.prisma.$queryRaw<
      Array<{
        sendBatchId: string;
        title: string;
        content: string;
        type: string;
        level: string;
        createdAt: Date;
        receiverCount: bigint;
        receiverTypeCount: bigint;
      }>
    >(
      Prisma.sql`SELECT sendBatchId,
                        MIN(title)    AS title,
                        MIN(content)  AS content,
                        MIN(type)     AS type,
                        MIN(level)    AS level,
                        MIN(createdAt) AS createdAt,
                        COUNT(*)                   AS receiverCount,
                        COUNT(DISTINCT receiverType) AS receiverTypeCount
                 FROM notifications
                 WHERE ${whereSql}
                 GROUP BY sendBatchId
                 ORDER BY MIN(createdAt) DESC, sendBatchId DESC
                 LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    );

    return {
      // mysql 驱动把 COUNT 返回为 BigInt，出参前统一转 number（否则 JSON 序列化 500）
      list: rows.map((r) => ({
        sendBatchId: r.sendBatchId,
        title: r.title,
        content: r.content,
        type: r.type,
        level: r.level,
        createdAt: r.createdAt,
        receiverCount: Number(r.receiverCount),
        receiverTypeCount: Number(r.receiverTypeCount),
      })),
      total: Number(totalRow?.total ?? 0),
      page,
      pageSize,
    };
  }

  /**
   * 可选发布目标（S5.4-B2）
   *
   * 与 `POST /notifications` **共用** `senderMerchantScope`，保证「可选项」与「发送校验」口径完全一致：
   *  - targets 返回的每个商家 / 门店，逐个 POST 都必须成功（不会「前端显示可发 → 后端拒绝」）；
   *  - 未返回的目标（非直属附属 / 未审核 / 已停业），POST 必定 403。
   *
   * 返回 `{ merchants: [{id,name,code}], stores: [{id,name,code,merchantId}] }`，
   * stores 带 `merchantId` 便于前端按商家分组展示。
   */
  async targets(user: JwtPayload) {
    const scope = await this.senderMerchantScope(user);
    // 上限保护：targets **不分页**（见 docs/03），商家/门店各取上限 2000，命中即告警
    const LIMIT = 2000;
    const [merchants, stores] = await Promise.all([
      this.prisma.merchant.findMany({
        where: { AND: [scope, { status: MerchantStatus.APPROVED }] },
        select: { id: true, name: true, code: true },
        orderBy: { id: 'asc' },
        take: LIMIT,
      }),
      this.prisma.store.findMany({
        where: {
          status: StoreStatus.OPEN,
          merchant: { AND: [scope, { status: MerchantStatus.APPROVED }] },
        },
        select: { id: true, name: true, code: true, merchantId: true },
        orderBy: { id: 'asc' },
        take: LIMIT,
      }),
    ]);
    if (merchants.length >= LIMIT || stores.length >= LIMIT) {
      this.logger.warn(`targets 超过 ${LIMIT}，需要分页（merchants=${merchants.length} stores=${stores.length}）`);
    }
    return { merchants, stores };
  }

  /**
   * 某个发送批次的收件人明细（S5.4-B2：「发件箱 → 查看本批发给了谁」）
   *
   * 安全边界与 `listSent` 一致：先过 `senderMerchantScope`（仅平台/主体），
   * 再要求 `senderId = 当前账号` —— 别人的 / 不存在的批次一律 404（不泄露存在性）。
   * 名称用两次批量查询解析（避免 N+1）；单批上限 500（targets 上限 200，正常发送远小于此）。
   */
  async batchReceivers(sendBatchId: string, user: JwtPayload) {
    await this.senderMerchantScope(user);

    const LIMIT = 500;
    const rows = await this.prisma.notification.findMany({
      where: { sendBatchId, senderId: user.sub },
      select: { id: true, receiverType: true, receiverId: true, createdAt: true },
      orderBy: { id: 'asc' },
      take: LIMIT,
    });
    if (!rows.length) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '发送批次不存在或不属于你');
    }

    const merchantIds = [
      ...new Set(rows.filter((r) => r.receiverType === ReceiverType.MERCHANT).map((r) => r.receiverId)),
    ];
    const storeIds = [...new Set(rows.filter((r) => r.receiverType === ReceiverType.STORE).map((r) => r.receiverId))];
    // 空数组也照常查询（`in: []` 返回空集），避免三元表达式把数组合成 union 导致 map 推断失效
    const [merchants, stores] = await Promise.all([
      this.prisma.merchant.findMany({
        where: { id: { in: merchantIds } },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.store.findMany({
        where: { id: { in: storeIds } },
        select: { id: true, name: true, code: true, merchantId: true },
      }),
    ]);
    const merchantMap = new Map(merchants.map((m) => [m.id, m] as const));
    const storeMap = new Map(stores.map((s) => [s.id, s] as const));

    return {
      sendBatchId,
      receivers: rows.map((r) =>
        r.receiverType === ReceiverType.STORE
          ? {
              receiverType: r.receiverType,
              receiverId: r.receiverId,
              name: storeMap.get(r.receiverId)?.name ?? `门店 #${r.receiverId}`,
              code: storeMap.get(r.receiverId)?.code ?? null,
              merchantId: storeMap.get(r.receiverId)?.merchantId ?? null,
            }
          : {
              receiverType: r.receiverType,
              receiverId: r.receiverId,
              name: merchantMap.get(r.receiverId)?.name ?? `商家 #${r.receiverId}`,
              code: merchantMap.get(r.receiverId)?.code ?? null,
              merchantId: null,
            },
      ),
    };
  }
}
