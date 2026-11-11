import { Body, Controller, Get, Headers, Ip, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { CouponCodeService } from './coupon-code.service';
import { GenerateCodesDto, QueryCodesDto } from './dto/coupon-code.dto';

/**
 * 券码预生成 / 查询（S2.2）
 *
 * 挂在 `coupon-templates` 下（`/coupon-templates/:id/codes`），
 * 与券模板同域：能看到模板才拿得到券码。
 */
@ApiTags('coupon-codes')
@ApiBearerAuth()
@Controller('coupon-templates')
export class CouponCodeController {
  constructor(private readonly codes: CouponCodeService) {}

  @Post(':id/codes')
  @Permissions('coupon:code:generate')
  @ApiOperation({
    summary: '预生成券码（批次号 + 数量）',
    description:
      '券码为 12 位（11 位 crypto 随机位 + 1 位校验位），字符集去掉 0/O/1/I/L；batchNo 不传自动生成 `{templateId}-{yyyymmdd}-{seq}`，重复批次 409 BATCH_ALREADY_EXISTS。',
  })
  generate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GenerateCodesDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.codes.generate(id, dto, user, ip, ua);
  }

  @Get(':id/codes')
  @Permissions('coupon:view')
  @ApiOperation({
    summary: '券码列表（分页 + 状态/批次筛选）',
    description: '越权访问（看不到该模板）一律 404，不返回任何券码明文。',
  })
  list(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryCodesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.codes.list(id, query, user);
  }

  @Get(':id/batches')
  @Permissions('coupon:view')
  @ApiOperation({ summary: '券码批次列表（含每批实际生成数量）' })
  batches(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.codes.batches(id, user);
  }
}
