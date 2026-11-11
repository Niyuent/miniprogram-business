import { Body, Controller, Get, Headers, Ip, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { QueryNotificationDto, QuerySentNotificationDto, SendNotificationDto } from './dto/notification.dto';
import { NotificationService } from './notification.service';

/**
 * 站内信（S5.4-A）
 *
 * 权限：
 *  - `notification:view` —— 查看 / 未读数 / 标记已读（主体、附属、店员）
 *  - `notification:send` —— 发布（仅主体 / 平台）
 *
 * 数据隔离一律在 NotificationService 内由 JWT 推导，不接受任何 receiverId 入参。
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  @Permissions('notification:view')
  @ApiOperation({ summary: '我的通知列表（分页；readStatus=UNREAD 只看未读；附带 unreadCount）' })
  list(@Query() query: QueryNotificationDto, @CurrentUser() user: JwtPayload) {
    return this.service.list(query, user);
  }

  @Get('unread-count')
  @Permissions('notification:view')
  @ApiOperation({ summary: '我的未读通知数' })
  unreadCount(@CurrentUser() user: JwtPayload) {
    return this.service.unreadCount(user);
  }

  @Get('sent')
  @Permissions('notification:send')
  @ApiOperation({
    summary: '我发过的通知（按发送批次聚合，一次发送 = 一条；权限 notification:send）',
    description: '「全部发送」展开的 N 行会聚合成 1 条并返回 receiverCount；同一秒内的两次同名发送不会被误合并。',
  })
  listSent(@Query() query: QuerySentNotificationDto, @CurrentUser() user: JwtPayload) {
    return this.service.listSent(query, user);
  }

  @Get('sent/:sendBatchId')
  @Permissions('notification:send')
  @ApiOperation({
    summary: '某批发送的收件人明细（只能看自己发的批次）',
    description: '「发件箱」点击某条发送后展示本批发给了哪些商家 / 门店；非本人或不存在 → 404 RESOURCE_NOT_FOUND。',
  })
  batchReceivers(@Param('sendBatchId') sendBatchId: string, @CurrentUser() user: JwtPayload) {
    return this.service.batchReceivers(sendBatchId, user);
  }

  @Get('targets')
  @Permissions('notification:send')
  @ApiOperation({
    summary: '可选发布目标（本主体可发布的附属商家 + 其营业中门店）',
    description:
      '与 POST /notifications **共用同一套 scope 断言**，保证「前端选得到的 = 后端允发的」。返回 { merchants: [...], stores: [...] }，stores 带 merchantId 便于分组展示。',
  })
  targets(@CurrentUser() user: JwtPayload) {
    return this.service.targets(user);
  }

  @Patch('read-all')
  @Permissions('notification:view')
  @ApiOperation({ summary: '我的通知全部标记已读（返回实际更新条数）' })
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.service.markAllRead(user);
  }

  @Patch(':id/read')
  @Permissions('notification:view')
  @ApiOperation({
    summary: '标记单条已读（幂等：已读再标记返回 alreadyRead=true）',
    description: '不在自己接收范围内的通知返回 404 RESOURCE_NOT_FOUND（不泄露存在性）。',
  })
  markRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.markRead(id, user);
  }

  @Post()
  @Permissions('notification:send')
  @ApiOperation({
    summary: '发布通知（主体 → 指定附属商家 / 指定门店 / 全部附属 / 全部门店）',
    description:
      '目标只能是本主体直属附属商家及其门店，范围外商家 403 FORBIDDEN_SCOPE、门店 403 STORE_NOT_OWNED。' +
      'ALL_* 发布时展开为一人一行（已读状态按行记录）。同事务写审计 notification:send。',
  })
  send(
    @Body() dto: SendNotificationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.service.send(dto, user, ip, ua);
  }
}
