import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { CouponInstanceService } from './coupon-instance.service';
import { FreezeInstanceDto, IssueCouponDto, QueryInstancesDto } from './dto/coupon-instance.dto';

/**
 * 券实例（S2.2）
 *
 * `POST /coupon-instances/issue` 是整个 S2 的**核心接口**：
 * 发券方由 JWT 推导，发别人的主体券必须过 S1.3 的 `checkAuthorization`
 * （未授权 / 非主体券 / 范围外 / 未上架各自独立错误码），
 * 库存与券码用条件更新 + `FOR UPDATE` 保证并发下不超发。
 *
 * 权限码用 **OR** 语义（RolesGuard 是 `some`）：`coupon:issue-main` 与 `coupon:issue` 任一即可。
 */
@ApiTags('coupon-instances')
@ApiBearerAuth()
@Controller('coupon-instances')
export class CouponInstanceController {
  constructor(private readonly instances: CouponInstanceService) {}

  @Post('issue')
  @Permissions('coupon:issue-main', 'coupon:issue')
  @ApiOperation({
    summary: '发放券实例（核心：接 checkAuthorization）',
    description:
      '流程：① 授权/状态校验（403 SUB_MERCHANT_NOT_AUTHORIZED / CAN_ONLY_ISSUE_MAIN_COUPON / TEMPLATE_NOT_IN_AUTHORIZED_SCOPE / TEMPLATE_NOT_AVAILABLE）→ ② 库存条件更新（409 STOCK_EXHAUSTED）→ ③ 券码 FOR UPDATE 取用（409 CODE_POOL_EXHAUSTED）→ ④ 建实例 + 绑码 → ⑤ 同事务写审计 coupon:issue。',
  })
  issue(
    @Body() dto: IssueCouponDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.instances.issueWithScope(dto, user, ip, ua);
  }

  @Get()
  @Permissions('coupon:instance:view')
  @ApiOperation({
    summary: '券实例列表（模板 / 用户 / 状态 / 有效期筛选，分页）',
    description: '数据隔离：主体看自己拥有或创建的模板下的券，附属只看自己发放或自己拥有的。',
  })
  list(@Query() query: QueryInstancesDto, @CurrentUser() user: JwtPayload) {
    return this.instances.list(query, user);
  }

  @Get(':id')
  @Permissions('coupon:instance:view')
  @ApiOperation({ summary: '券实例详情（含适用门店）' })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.instances.detail(id, user);
  }

  @Patch(':id/freeze')
  @Permissions('coupon:instance:freeze')
  @ApiOperation({ summary: '冻结 / 解冻券实例（frozen=true 冻结）' })
  freeze(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FreezeInstanceDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.instances.freeze(id, dto, user, ip, ua);
  }
}
