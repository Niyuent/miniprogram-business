import { Body, Controller, Get, Headers, Ip, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { CreateOrderDto, HandleOrderDto, MarkAbnormalDto, QueryOrdersDto } from './dto/order.dto';
import { OrderService } from './order.service';

/**
 * 订单管理 + 异常订单处理（S3.4）
 *
 * 数据隔离：平台全量 / 主体=自己+直属附属 / 附属&店员=本店（越权 → 403 STORE_NOT_OWNED）。
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  @Permissions('order:view')
  @ApiOperation({ summary: '订单列表（主体全平台 / 附属本店 / 店员本店）' })
  list(@Query() query: QueryOrdersDto, @CurrentUser() user: JwtPayload) {
    return this.orders.list(query, user);
  }

  // 注意：/orders/abnormal 必须在 /orders/:id 之前声明，否则会被 :id 吃掉
  @Get('abnormal')
  @Permissions('order:view')
  @ApiOperation({ summary: '异常订单列表（status=ABNORMAL）' })
  listAbnormal(@Query() query: QueryOrdersDto, @CurrentUser() user: JwtPayload) {
    return this.orders.listAbnormal(query, user);
  }

  @Get(':id')
  @Permissions('order:view')
  @ApiOperation({ summary: '订单详情（含券、积分流水、核销记录）' })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.orders.detail(id, user);
  }

  @Post()
  @Permissions('order:handle', 'point:earn')
  @ApiOperation({ summary: '后台补录订单（走 /points/earn 送积分，一单只送一次）' })
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: JwtPayload, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.orders.create(dto, user, ip, ua);
  }

  @Patch(':id/abnormal')
  @Permissions('order:mark-abnormal')
  @ApiOperation({ summary: '标记异常（NORMAL → ABNORMAL，附属也可标记本店订单）' })
  markAbnormal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkAbnormalDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.orders.markAbnormal(id, dto, user, ip, ua);
  }

  @Post(':id/handle')
  @Permissions('order:handle')
  @ApiOperation({
    summary: '异常订单处理（CANCEL / AMOUNT_ERROR / DISPUTE）',
    description:
      '三种处理都单事务：CANCEL→券回 UNUSED+积分回原批次+订单 couponInstanceId 清空；' +
      'AMOUNT_ERROR→ADJUST 负流水冲正；DISPUTE→冲正核销+券回 UNUSED+积分回退。并发处理只有 1 个成功 → 409 ORDER_ALREADY_HANDLED。',
  })
  handle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HandleOrderDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.orders.handle(id, dto, user, ip, ua);
  }
}
