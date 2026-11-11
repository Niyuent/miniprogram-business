import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { BizException } from '../../common/exceptions/biz.exception';
import { ApiTokenGuard } from '../auth/api-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt-payload';
import { SseService, type SseTarget } from './sse.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('sse')
@Controller('sse')
export class SseController {
  constructor(private readonly sse: SseService) {}

  /**
   * 1) 凭 JWT 换取一次性 ticket（60 秒有效）
   * 前端拿到 ticket 后再建立 EventSource 连接，避免 URL 中暴露 JWT
   */
  @Post('ticket')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '凭 JWT 换取 SSE 一次性 ticket（60s）' })
  createTicket(@CurrentUser() user: JwtPayload) {
    const { ticket, expiresIn } = this.sse.createTicket({
      userId: user.sub,
      merchantId: user.merchantId,
      storeId: user.storeId,
      userType: user.userType,
      username: user.username,
    });
    return { ticket, expiresIn, connectUrl: `/api/v1/sse/notifications?ticket=${ticket}` };
  }

  /**
   * 2) 用 ticket 建立事件流（EventSource 不支持自定义 Header，故 ticket 走 query）
   * 服务端按 ticket 反查 userId / merchantId，只推送该维度通知
   */
  @Get('notifications')
  // 必须 @Public：EventSource 不能自定义 Header，无法携带 Authorization；
  // 本端点的鉴权由 **一次性 ticket**（consumeTicket）承担，全局 JwtAuthGuard 不能再拦。
  @Public()
  @ApiOperation({ summary: 'SSE 事件流（?ticket=一次性票据）' })
  notifications(@Query('ticket') ticket: string, @Req() req: Request, @Res() res: Response) {
    const identity = this.sse.consumeTicket(ticket);
    if (!identity) {
      throw BizException.forbidden('INVALID_SSE_TICKET', 'ticket 无效、已使用或已过期');
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 关键：告知 Nginx 不要缓冲本响应
      'X-Accel-Buffering': 'no',
    });
    (res.socket as { setNoDelay?: (b: boolean) => void } | null)?.setNoDelay?.(true);

    res.write('retry: 3000\n\n');
    res.write(
      `event: connected\ndata: ${JSON.stringify({
        userId: identity.userId,
        merchantId: identity.merchantId,
        at: new Date().toISOString(),
      })}\n\n`,
    );

    this.sse.addClient(res, identity);
    req.on('close', () => this.sse.removeClient(res));
    req.on('error', () => this.sse.removeClient(res));
  }

  /**
   * 3) 推送接口（外部系统 / 内部通知模块调用，走 API_TOKEN）
   * body: { event, data, target?: { userId, merchantId } }
   */
  @Post('publish')
  @Public()
  @UseGuards(ApiTokenGuard)
  @ApiOperation({ summary: '【外部系统对接】向指定维度推送 SSE 事件' })
  publish(
    @Body() body: { event: string; data?: unknown; target?: SseTarget },
  ) {
    const sent = this.sse.broadcast(body.event ?? 'message', body.data ?? {}, body.target);
    return { sent, target: body.target ?? 'all' };
  }

  /** 4) 运维统计（API_TOKEN） */
  @Get('stats')
  @Public()
  @UseGuards(ApiTokenGuard)
  @ApiOperation({ summary: 'SSE 连接统计（API_TOKEN）' })
  stats() {
    return this.sse.stats();
  }
}
