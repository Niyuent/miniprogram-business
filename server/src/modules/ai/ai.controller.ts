import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { Permissions } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { AiService } from './ai.service';
import { AnalyzeAbnormalDto, IdentifyUserDto, RecognizeLicenseDto, RunDailyReportDto } from './dto/ai.dto';

/**
 * 经营日报手动触发（验收 / 补跑）。定时任务见 AiCronService，每天 22:00。
 * 权限只在种子里发给主体和平台（permissionDefs 全量），附属没有这个码。
 */
@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('daily-reports/run')
  @Permissions('ai:report:run')
  @ApiOperation({
    summary: '立即生成经营日报并推送站内信',
    description:
      '状态由 Laya choice 判断；文案优先 DeepSeek，两边失败都走数字模板。同一商家同一天已发过则跳过。',
  })
  async run(@Body() dto: RunDailyReportDto) {
    if (dto.merchantId) {
      const merchant = await this.prisma.merchant.findUnique({
        where: { id: dto.merchantId },
        select: { id: true, name: true },
      });
      if (!merchant) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '商家不存在');
      const report = await this.ai.runOne(merchant.id, merchant.name);
      return { skipped: false, reports: [report] };
    }
    return this.ai.runAll();
  }

  @Post('identify-user')
  @Permissions('point:earn')
  @ApiOperation({
    summary: '扫码录单时判断刚才那位客人',
    description: 'Laya 在最近扫码的姓名里做 choice。超时或服务不可用时，取 minutesAgo 最小的一位。',
  })
  identify(@Body() dto: IdentifyUserDto, @CurrentUser() user: JwtPayload) {
    return this.ai.identifyUser(user.merchantId, dto);
  }

  @Post('analyze-abnormal')
  @Permissions('order:handle')
  @ApiOperation({
    summary: '异常订单智能归因',
    description: 'Laya 在四种判断里做 choice。超时则按近 1 小时笔数降级。只返回建议，不改订单。',
  })
  analyzeAbnormal(@Body() dto: AnalyzeAbnormalDto, @CurrentUser() user: JwtPayload) {
    return this.ai.analyzeAbnormal(user, dto.orderId);
  }

  @Post('recognize-license')
  @Permissions('merchant:audit')
  @ApiOperation({
    summary: '入驻执照辅助提取',
    description: '未配置云 OCR。18 位执照号回显为信用代码，法人姓名留空，供前端和申请表对比。',
  })
  recognizeLicense(@Body() dto: RecognizeLicenseDto) {
    return this.ai.recognizeLicense(dto.merchantId);
  }
}
