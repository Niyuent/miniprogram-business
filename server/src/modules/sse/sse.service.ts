import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Response } from 'express';

/** 连接身份：由 ticket 反查得到，决定推送维度 */
export interface SseIdentity {
  userId: number;
  merchantId: number | null;
  storeId: number | null;
  userType: string;
  username: string;
}

/**
 * 推送目标：按用户 / 商家 / 门店维度隔离，缺省则广播
 *
 * - `{ userId }`        只推该后台账号
 * - `{ merchantId }`    该商家下**所有**在线连接（商家管理员 + 其所有门店店员）
 * - `{ merchantId, storeId }`  商家管理员（storeId=null）+ **该门店**店员（精确到店，同商家其它门店收不到）
 *
 * 最后一个组合是 S7 为「发给某个 STORE 的站内信」准备的：通知接收范围是
 * 「该门店店员 ∪ 该门店所属商家的管理员」，用 merchantId 单独推会把同商家其它门店的店员误伤。
 */
export interface SseTarget {
  userId?: number;
  merchantId?: number;
  storeId?: number;
  /** 仅推送给平台账号 */
  platform?: boolean;
}

interface Client {
  res: Response;
  identity: SseIdentity;
}

interface TicketRecord {
  identity: SseIdentity;
  expiresAt: number;
}

/**
 * SSE 服务：ticket 鉴权 + 按 user / merchant 维度隔离推送
 * 注意：Nginx 对应 location 必须 proxy_buffering off（见 deploy/nginx/gateway.conf）
 */
@Injectable()
export class SseService implements OnModuleDestroy {
  private readonly logger = new Logger('SSE');
  private readonly clients = new Set<Client>();
  private readonly tickets = new Map<string, TicketRecord>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private sweeper?: ReturnType<typeof setInterval>;
  /** 在构造期读取，确保 ConfigModule 已加载 .env */
  private readonly ticketTtlMs = Number(process.env.SSE_TICKET_TTL_MS ?? 60_000);

  constructor() {
    const hb = Number(process.env.SSE_HEARTBEAT_MS ?? 30_000);
    this.heartbeat = setInterval(() => this.ping(), hb);
    this.sweeper = setInterval(() => this.sweepTickets(), 15_000);
  }

  onModuleDestroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.sweeper) clearInterval(this.sweeper);
    for (const c of this.clients) this.end(c.res);
    this.clients.clear();
    this.tickets.clear();
  }

  /** 签发一次性 ticket（默认 60 秒） */
  createTicket(identity: SseIdentity) {
    const ticket = randomUUID().replace(/-/g, '');
    this.tickets.set(ticket, { identity, expiresAt: Date.now() + this.ticketTtlMs });
    return { ticket, expiresIn: Math.floor(this.ticketTtlMs / 1000) };
  }

  /** 消费 ticket：一次性，过期即失效 */
  consumeTicket(ticket: string): SseIdentity | null {
    if (!ticket) return null;
    const record = this.tickets.get(ticket);
    if (!record) return null;
    this.tickets.delete(ticket); // 一次性
    if (record.expiresAt < Date.now()) return null;
    return record.identity;
  }

  addClient(res: Response, identity: SseIdentity) {
    this.clients.add({ res, identity });
    this.logger.log(
      `用户 ${identity.username}(merchant=${identity.merchantId}) 接入，连接数 ${this.clients.size}`,
    );
  }

  removeClient(res: Response) {
    for (const c of this.clients) {
      if (c.res === res) {
        this.clients.delete(c);
        this.logger.log(`客户端断开，连接数 ${this.clients.size}`);
        return;
      }
    }
  }

  /**
   * 推送事件：仅发给匹配 target 的连接
   * - target.userId：只推该用户
   * - target.merchantId：只推该商家下所有连接
   * - 无 target：全量广播（仅内部/平台级使用）
   */
  broadcast(event: string, data: unknown, target?: SseTarget): number {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    let sent = 0;
    for (const client of this.clients) {
      if (!this.match(client.identity, target)) continue;
      try {
        client.res.write(payload);
        sent++;
      } catch {
        this.clients.delete(client);
      }
    }
    return sent;
  }

  stats() {
    const byMerchant: Record<string, number> = {};
    for (const c of this.clients) {
      const key = String(c.identity.merchantId);
      byMerchant[key] = (byMerchant[key] ?? 0) + 1;
    }
    return { connections: this.clients.size, pendingTickets: this.tickets.size, byMerchant };
  }

  private match(identity: SseIdentity, target?: SseTarget) {
    if (!target) return true;
    if (target.platform) return identity.userType === 'PLATFORM';
    if (target.userId !== undefined && identity.userId !== target.userId) return false;
    if (target.merchantId !== undefined && identity.merchantId !== target.merchantId) return false;
    if (target.storeId !== undefined) {
      // 门店维度：命中「该门店的店员」或「该商家下未绑定门店的管理员」
      // 注意用 `== null`：JWT 未带 storeId 字段时是 undefined，商家管理员也可能是 null
      const isThatStoreClerk = identity.storeId === target.storeId;
      const isMerchantAdmin = identity.storeId == null;
      if (!isThatStoreClerk && !isMerchantAdmin) return false;
    }
    return true;
  }

  private ping() {
    for (const client of this.clients) {
      try {
        client.res.write(': ping\n\n');
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private sweepTickets() {
    const now = Date.now();
    for (const [ticket, record] of this.tickets) {
      if (record.expiresAt < now) this.tickets.delete(ticket);
    }
  }

  private end(res: Response) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
}
