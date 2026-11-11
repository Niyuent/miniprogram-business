import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Permissions } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { MerchantService } from './merchant.service';
import {
  ApproveApplicationDto,
  CreateApplicationDto,
  QueryApplicationsDto,
  RejectApplicationDto,
} from './dto/application.dto';
import { JoinAllianceDto, QueryMerchantsDto, UpdateMerchantStatusDto } from './dto/merchant.dto';

/**
 * 商家与入驻审核
 *
 * 权限：
 *  - 提交入驻申请：公开（`@Public`）
 *  - 申请列表：需 `merchant:view`
 *  - 审核通过 / 驳回：需 `merchant:audit`
 *  - 启停：需 `merchant:manage`
 *
 * 数据可见范围由 `MerchantService.visibilityWhere()` 按 JWT 归属强制收敛，
 * 不信任任何前端传入的 merchantId。
 */
@ApiTags('merchant')
@ApiBearerAuth()
@Controller('merchants')
export class MerchantController {
  constructor(
    private readonly merchants: MerchantService,
    private readonly rateLimit: RateLimitService,
  ) {}

  // ---------------------------------------------------------------- 入驻申请

  @Post('applications')
  @Public()
  @ApiOperation({
    summary: '提交入驻申请（公开，无需登录）',
    description: '这是一个无需登录即可写库的端点，同 IP 每小时最多 3 次，超限返回 429 RATE_LIMITED。',
  })
  createApplication(
    @Body() dto: CreateApplicationDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    // 公开接口必须限流，否则可被无成本地灌垃圾申请
    this.rateLimit.check(`merchant-application:${ip ?? 'unknown'}`, 3, 60 * 60 * 1000);
    return this.merchants.createApplication(dto, ip, ua);
  }

  @Get('applications')
  @Permissions('merchant:view')
  @ApiOperation({ summary: '入驻申请列表（默认待审核）' })
  listApplications(@Query() query: QueryApplicationsDto, @CurrentUser() user: JwtPayload) {
    return this.merchants.listApplications(query, user);
  }

  @Post('applications/:id/approve')
  @Permissions('merchant:audit')
  @ApiOperation({
    summary: '审核通过（自动创建管理员账号并一次性返回初始口令）',
    description: '重复审核返回 409 MERCHANT_NOT_PENDING；账号口令为随机 12 位，仅在本次响应中出现。',
  })
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveApplicationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.merchants.approve(id, dto, user, ip, ua);
  }

  @Post('applications/:id/reject')
  @Permissions('merchant:audit')
  @ApiOperation({ summary: '驳回申请（auditRemark 必填）' })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectApplicationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.merchants.reject(id, dto, user, ip, ua);
  }

  // ---------------------------------------------------------------- 商家管理

  @Get()
  @Permissions('merchant:view')
  @ApiOperation({ summary: '商家列表（平台看全部，主体看自己+直属附属）' })
  list(@Query() query: QueryMerchantsDto, @CurrentUser() user: JwtPayload) {
    return this.merchants.list(query, user);
  }

  @Get(':id/alliances')
  @Public()
  @ApiOperation({
    summary: '商家所属联盟列表（多联盟发分前选择）',
    description:
      '查询 merchant_alliances。公开可读（扫码发分页用）。返回联盟名、本店角色、同联盟其它商家示例，' +
      '以及当前档位与联盟用量（初级 2 / 高级 10）。',
  })
  listAlliances(@Param('id', ParseIntPipe) id: number) {
    return this.merchants.listAlliances(id);
  }

  @Post(':id/alliances')
  @ApiOperation({ summary: '加入联盟（受档位上限与盟主会员状态约束）' })
  joinAlliance(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: JoinAllianceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.merchants.joinAlliance(id, dto.allianceId, user);
  }

  @Delete(':id/alliances/:allianceId')
  @ApiOperation({ summary: '退出联盟（盟主不可退出自己的联盟）' })
  quitAlliance(
    @Param('id', ParseIntPipe) id: number,
    @Param('allianceId', ParseIntPipe) allianceId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.merchants.quitAlliance(id, allianceId, user);
  }

  @Get(':id')
  @Permissions('merchant:view')
  @ApiOperation({ summary: '商家详情（含门店、账号、父级）' })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.merchants.detail(id, user);
  }

  @Patch(':id/status')
  @Permissions('merchant:manage')
  @ApiOperation({
    summary: '启用 / 暂停商家',
    description: 'APPROVED ↔ SUSPENDED；写 audit_logs（操作人 + 时间）。停用后其账号登录会被拒绝。',
  })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMerchantStatusDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
    @Req() _req: Request,
  ) {
    return this.merchants.updateStatus(id, dto, user, ip, ua);
  }
}
