import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { TrendQueryDto } from './dto/report.dto';
import { ReportService } from './report.service';

/**
 * 工作台（S4.3）
 *
 * `stats` 里的卡片口径与 `todo` 分开提供：前端首屏只要卡片时不必连带查待办，
 * 待办侧栏可单独轮询（/dashboard/todo）。
 */
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly reports: ReportService) {}

  @Get('stats')
  @Permissions('dashboard:view')
  @ApiOperation({ summary: '工作台卡片（今日订单 / 核销 / 兑换 / 发券，含环比）' })
  stats(@CurrentUser() user: JwtPayload) {
    return this.reports.stats(user);
  }

  @Get('trend')
  @Permissions('dashboard:view')
  @ApiOperation({ summary: '近 N 天趋势（订单 / 核销 / 兑换），days 默认 7' })
  trend(@Query() q: TrendQueryDto, @CurrentUser() user: JwtPayload) {
    return this.reports.trend(q, user);
  }

  @Get('todo')
  @Permissions('dashboard:view')
  @ApiOperation({ summary: '待办数量：待审商家 / 异常订单 / 未读通知' })
  todo(@CurrentUser() user: JwtPayload) {
    return this.reports.todo(user);
  }

  @Get('distribution')
  @Permissions('dashboard:view')
  @ApiOperation({ summary: '分布：券类型分布 + 积分来源分布（隔离到角色视角）' })
  distribution(@CurrentUser() user: JwtPayload) {
    return this.reports.distribution(user);
  }

  @Get('top-merchants')
  @Permissions('dashboard:view')
  @ApiOperation({ summary: '交易额 Top5 商家（仅平台/主体可见，附属/店员返回空）' })
  topMerchants(@CurrentUser() user: JwtPayload) {
    return this.reports.topMerchants(user);
  }

  @Get('galaxy')
  @Permissions('dashboard:view')
  @ApiOperation({
    summary: '星系视图：中心商家 + 环绕附属（大小=本月交易额，颜色=状态）+ 交易额边',
    description: '平台/主体可用；**附属/店员返回 403 FORBIDDEN_SCOPE**（前端据此降级为数据视图）。',
  })
  galaxy(@CurrentUser() user: JwtPayload) {
    return this.reports.galaxy(user);
  }
}
