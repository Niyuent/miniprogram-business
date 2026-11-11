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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { CouponTemplateService } from './coupon-template.service';
import {
  CreateCouponTemplateDto,
  QueryCouponTemplatesDto,
  UpdateCouponTemplateDto,
} from './dto/coupon-template.dto';

/**
 * 券模板管理（S2.1）
 *
 * 可见性：**读取按身份收敛，写操作一律只认「本主体创建或拥有」**。
 *  - 主体商家：自己创建的（含代附属商家建的券）+ 自己拥有的；
 *  - 附属商家：自己拥有的 + 授权范围内且已上架的主体券（授权撤销后列表立刻消失，无缓存）；
 *  - 平台管理员：全部。
 *
 * 路由顺序：`/coupon-templates` 的下级没有字面量子路由，`:id` 直接放最后即可，
 * 但仍保持在 `publish` / `unpublish` 之后，避免将来新增同级路由被 `:id` 吃掉。
 */
@ApiTags('coupon-templates')
@ApiBearerAuth()
@Controller('coupon-templates')
export class CouponTemplateController {
  constructor(private readonly templates: CouponTemplateService) {}

  @Get()
  @Permissions('coupon:view')
  @ApiOperation({
    summary: '券模板列表（分页 + 筛选）',
    description:
      '按调用方身份收敛可见范围：主体看自己创建/拥有，附属看自己拥有 + 授权范围内的已上架主体券。',
  })
  list(@Query() query: QueryCouponTemplatesDto, @CurrentUser() user: JwtPayload) {
    return this.templates.list(query, user);
  }

  @Get(':id/effect-details')
  @Permissions('coupon:view')
  @ApiOperation({
    summary: '券效果明细（核销用户与实付金额）',
    description: '列出该模板下 SUCCESS 核销记录及关联订单实付，供商家看板下钻。',
  })
  effectDetails(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.templates.effectDetails(id, user, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Get(':id')
  @Permissions('coupon:view')
  @ApiOperation({
    summary: '券模板详情（含券码与券实例统计）',
    description: '不在可见范围内的模板一律 404（不暴露存在性）。',
  })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.templates.detail(id, user);
  }

  @Post()
  @Permissions('coupon:create')
  @ApiOperation({
    summary: '创建券模板（H1：创建者必须是主体商家）',
    description:
      'creatorMerchantId 始终取调用方所属主体，**不接受前端指定**；附属商家账号进来直接 403 COUPON_CREATOR_NOT_MAIN。创建后固定为 DRAFT，需显式上架。',
  })
  create(
    @Body() dto: CreateCouponTemplateDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.templates.create(dto, user, ip, ua);
  }

  @Put(':id')
  @Permissions('coupon:edit')
  @ApiOperation({
    summary: '编辑券模板（仅 DRAFT / UNPUBLISHED）',
    description: '已上架的模板必须先下架才能改（TEMPLATE_NOT_EDITABLE），避免改掉已在用户手上的券口径。',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCouponTemplateDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.templates.update(id, dto, user, ip, ua);
  }

  @Patch(':id/publish')
  @Permissions('coupon:publish')
  @ApiOperation({ summary: '上架券模板（DRAFT / UNPUBLISHED → PUBLISHED）' })
  publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.templates.publish(id, user, ip, ua);
  }

  @Patch(':id/unpublish')
  @Permissions('coupon:publish')
  @ApiOperation({ summary: '下架券模板（PUBLISHED → UNPUBLISHED）' })
  unpublish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.templates.unpublish(id, user, ip, ua);
  }
}
