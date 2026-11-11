import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BizException, ReasonCode } from '../../../common/exceptions/biz.exception';
import { Permissions } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtPayload } from '../../auth/jwt-payload';
import { shanghaiDay } from '../daily-report';
import {
  AbnormalMerchantsQueryDto,
  BusinessSummaryQueryDto,
  CouponPerformanceQueryDto,
  LostMembersQueryDto,
} from '../dto/chat.dto';
import { AiToolsService } from './ai-tools.service';

@ApiTags('ai-tools')
@ApiBearerAuth()
@Controller('ai-tools')
export class AiToolsController {
  constructor(private readonly tools: AiToolsService) {}

  private requireMerchantId(user: JwtPayload): number {
    if (!user.merchantId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '仅商家账号可调用');
    }
    return user.merchantId;
  }

  @Get('business-summary')
  @Permissions('ai:chat')
  @ApiOperation({ summary: '营收摘要（只读，merchantId 取自 JWT）' })
  businessSummary(@Query() query: BusinessSummaryQueryDto, @CurrentUser() user: JwtPayload) {
    const merchantId = this.requireMerchantId(user);
    const from = query.from || shanghaiDay(-1).ymd;
    const to = query.to || from;
    const compare = query.compare === 'prev_month' ? 'prev_month' : 'prev_period';
    return this.tools.businessSummary(merchantId, from, to, compare);
  }

  @Get('coupon-performance')
  @Permissions('ai:chat')
  @ApiOperation({ summary: '券表现（只读）' })
  couponPerformance(@Query() query: CouponPerformanceQueryDto, @CurrentUser() user: JwtPayload) {
    const merchantId = this.requireMerchantId(user);
    return this.tools.couponPerformance(merchantId, query.days ?? 7, query.limit ?? 20);
  }

  @Get('lost-members')
  @Permissions('ai:chat')
  @ApiOperation({ summary: '流失会员（只读，分页）' })
  lostMembers(@Query() query: LostMembersQueryDto, @CurrentUser() user: JwtPayload) {
    const merchantId = this.requireMerchantId(user);
    return this.tools.lostMembers(merchantId, query.limit ?? 20, query.offset ?? 0);
  }

  @Get('abnormal-merchants')
  @Permissions('ai:report:run')
  @ApiOperation({ summary: '异常商家（仅 PLATFORM）' })
  async abnormalMerchants(
    @Query() query: AbnormalMerchantsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (user.userType !== 'PLATFORM') {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '仅平台可查看异常商家');
    }
    return this.tools.abnormalMerchants(query.hours ?? 24, query.limit ?? 50);
  }
}
