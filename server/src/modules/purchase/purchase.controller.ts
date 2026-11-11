import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { CreatePurchaseDto, QueryPurchasesDto, SettlePurchaseDto } from './dto/purchase.dto';
import { PurchaseService } from './purchase.service';

/**
 * 采购记录（S4.1）
 *
 * 采购记录不可删除，只能标记结算；主体可看全部，附属只能看自己作为 sub_merchant 的。
 */
@ApiTags('purchases')
@ApiBearerAuth()
@Controller('purchases')
export class PurchaseController {
  constructor(private readonly purchases: PurchaseService) {}

  @Get()
  @Permissions('purchase:view')
  @ApiOperation({ summary: '采购记录列表（主体全量 / 附属只看自己作为 sub 的）' })
  list(@Query() query: QueryPurchasesDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.list(query, user);
  }

  @Post()
  @Permissions('purchase:create')
  @ApiOperation({ summary: '新增采购记录（purchaseNo 自动生成）' })
  create(@Body() dto: CreatePurchaseDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.create(dto, user);
  }

  @Patch(':id/settle')
  @Permissions('purchase:settle')
  @ApiOperation({ summary: '标记已结算（UNSETTLED → SETTLED，不可回退）' })
  settle(@Param('id', ParseIntPipe) id: number, @Body() dto: SettlePurchaseDto, @CurrentUser() user: JwtPayload) {
    return this.purchases.settle(id, dto, user);
  }
}
