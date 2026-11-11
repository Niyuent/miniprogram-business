import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ConfirmSettlementDto, GenerateSettlementDto, QuerySettlementsDto } from './dto/settlement.dto';
import { SettlementService } from './settlement.service';

/**
 * 对账账单（S4.2）
 *
 * 对账金额 = Σ（本期核销券 face_value）；快照生成后不随后续数据变化；状态机 GENERATED→CONFIRMED/DISPUTED。
 */
@ApiTags('settlements')
@ApiBearerAuth()
@Controller('settlements')
export class SettlementController {
  constructor(private readonly settlements: SettlementService) {}

  @Post('generate')
  @Permissions('settlement:generate')
  @ApiOperation({ summary: '生成对账单（周期 + 商家，幂等）' })
  async generate(
    @Body() dto: GenerateSettlementDto,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.settlements.generate(dto, user);
    // 真正新建 → 201；幂等命中（返回已有对账单，未创建）→ 200
    if ((result as { idempotent?: boolean }).idempotent) {
      res.status(HttpStatus.OK);
    }
    return result;
  }

  @Get()
  @Permissions('settlement:view')
  @ApiOperation({ summary: '对账单列表（附属只看自己）' })
  list(@Query() query: QuerySettlementsDto, @CurrentUser() user: JwtPayload) {
    return this.settlements.list(query, user);
  }

  @Get(':id')
  @Permissions('settlement:view')
  @ApiOperation({ summary: '对账单详情（采购明细 + 核销明细）' })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.settlements.detail(id, user);
  }

  /**
   * 微信小程序 wx.request 不支持 PATCH（平台白名单里没有 PATCH），
   * 所以同一个 handler 同时挂在 PATCH 与 POST 上：Web 端用 PATCH，小程序用 POST。
   * 两边的权限、校验、审计完全一致，不存在绕过。
   */
  @Patch(':id/confirm')
  @Post(':id/confirm')
  @Permissions('settlement:confirm')
  @ApiOperation({ summary: '确认或提异议（GENERATED → CONFIRMED/DISPUTED）' })
  confirm(@Param('id', ParseIntPipe) id: number, @Body() dto: ConfirmSettlementDto, @CurrentUser() user: JwtPayload) {
    return this.settlements.confirm(id, dto, user);
  }

  @Get(':id/export')
  @Permissions('settlement:view')
  @ApiOperation({ summary: '导出核销明细 CSV（UTF-8 BOM）' })
  async export(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.settlements.exportCsv(id, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="settlement-${id}.csv"`);
    return csv;
  }
}
