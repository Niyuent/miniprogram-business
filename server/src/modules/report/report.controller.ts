import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ReportKey, ReportKeyParamDto, ReportQueryDto } from './dto/report.dto';
import { ReportService } from './report.service';

/**
 * 报表中心（S4.3）
 *
 * 六张报表统一支持 `from` / `to` / `merchantId` 筛选；导出走同一套筛选条件，
 * 保证「页面上看到什么，导出的就是什么」。
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('merchant-onboarding')
  @Permissions('report:view')
  @ApiOperation({ summary: '商户入驻报表：按状态汇总 + 按月新增趋势' })
  merchantOnboarding(@Query() q: ReportQueryDto, @CurrentUser() user: JwtPayload) {
    return this.reports.merchantOnboarding(q, user);
  }

  @Get('orders-summary')
  @Permissions('report:view')
  @ApiOperation({ summary: '全平台订单汇总：金额合计 + 按状态 + 按商家 + 按日趋势' })
  ordersSummary(@Query() q: ReportQueryDto, @CurrentUser() user: JwtPayload) {
    return this.reports.ordersSummary(q, user);
  }

  @Get('coupon-summary')
  @Permissions('report:view')
  @ApiOperation({ summary: '代金券汇总：按状态 + 按模板 + 核销率' })
  couponSummary(@Query() q: ReportQueryDto, @CurrentUser() user: JwtPayload) {
    return this.reports.couponSummary(q, user);
  }

  @Get('points-summary')
  @Permissions('report:view')
  @ApiOperation({ summary: '积分流水汇总：按类型 + 净变动' })
  pointsSummary(@Query() q: ReportQueryDto, @CurrentUser() user: JwtPayload) {
    return this.reports.pointsSummary(q, user);
  }

  @Get('store-settlement')
  @Permissions('report:view')
  @ApiOperation({ summary: '采购核销对账：采购额 vs 核销额 + 按商家差额' })
  storeSettlement(@Query() q: ReportQueryDto, @CurrentUser() user: JwtPayload) {
    return this.reports.storeSettlement(q, user);
  }

  @Get('authorization-logs')
  @Permissions('report:view')
  @ApiOperation({ summary: '授权记录：主体→附属授权明细（含撤销原因、模板范围）' })
  authorizationLogs(@Query() q: ReportQueryDto, @CurrentUser() user: JwtPayload) {
    return this.reports.authorizationLogs(q, user);
  }

  @Get(':key/export')
  @Permissions('report:export')
  @ApiOperation({ summary: '报表 CSV 导出（UTF-8 BOM + 引号转义，筛选条件与页面一致）' })
  async export(
    @Param() param: ReportKeyParamDto,
    @Query() q: ReportQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.reports.exportCsv(param.key as ReportKey, q, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${param.key}.csv"`);
    return csv;
  }
}
