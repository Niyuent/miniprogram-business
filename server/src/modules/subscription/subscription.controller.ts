import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import {
  ConfirmSubscriptionDto,
  QuerySubscriptionsDto,
  SubmitSubscriptionDto,
} from './dto/subscription.dto';
import { SubscriptionService } from './subscription.service';

/**
 * 商家计费：附属档位（初级 2 / 高级 10 个联盟）与主体会员（38.8/109/209/418）。
 *
 * 收款线下完成：商家提交 → 后台点「已收款」→ 立即生效。表结构已按支付回调预留
 * `payChannel`，以后接微信支付只需在回调里改成写 ACTIVE，不动业务逻辑。
 */
@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subs: SubscriptionService) {}

  @Get('catalog')
  @ApiOperation({ summary: '价格目录（档位上限、会员四档、试用天数）' })
  catalog() {
    return this.subs.catalog();
  }

  @Get('me')
  @ApiOperation({ summary: '本商家计费状态：档位、联盟用量、会员有效期' })
  me(@CurrentUser() user: JwtPayload) {
    if (!user.merchantId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '平台账号没有商家计费信息');
    }
    return this.subs.billing(user.merchantId);
  }

  @Get()
  @Permissions('subscription:view')
  @ApiOperation({ summary: '充值订单列表（商家看自己，平台看全部）' })
  list(@Query() query: QuerySubscriptionsDto, @CurrentUser() user: JwtPayload) {
    return this.subs.list(query, user);
  }

  @Post()
  @Permissions('subscription:submit')
  @ApiOperation({ summary: '提交充值申请（PENDING，待后台确认收款）' })
  submit(@Body() dto: SubmitSubscriptionDto, @CurrentUser() user: JwtPayload) {
    return this.subs.submit(dto, user);
  }

  @Post(':id/confirm')
  @Permissions('subscription:confirm')
  @ApiOperation({ summary: '确认收款并生效（续费顺延，不从今天重算）' })
  confirm(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmSubscriptionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subs.confirm(id, dto, user);
  }

  @Post(':id/cancel')
  @Permissions('subscription:cancel')
  @ApiOperation({ summary: '驳回 / 取消待确认单' })
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.subs.cancel(id, user);
  }
}
