import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/** 分页查询基类：page / pageSize */
export class PageQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 20;
}

/** 券归属类型：主体券 / 附属商家券（对应 Prisma CouponOwnerType） */
export type OwnerTypeValue = 'MAIN_COUPON' | 'SUB_COUPON';

/** 券类型：代金券（满减）/ 折扣券（S2 不开折扣计算，仅落字段） */
export type CouponTypeValue = 'VOUCHER' | 'DISCOUNT';

/** 有效期类型：固定区间 / 领取后 N 天 */
export type ValidTypeValue = 'FIXED' | 'AFTER_RECEIVE_DAYS';

/**
 * 适用范围
 * - ALL_STORES：全部门店（含后续新增门店）
 * - SPECIFIED_STORES：`storeIds[]` 内的门店
 * - SPECIFIED_MERCHANTS：按商家维度，**S2.1 未实现**，传了直接 400（不许「传了但不生效」）
 */
export type ApplyScopeValue = 'ALL_STORES' | 'SPECIFIED_STORES' | 'SPECIFIED_MERCHANTS';

/** 模板状态（对应 Prisma CouponTemplateStatus） */
export type TemplateStatusValue = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'VOID';

export class QueryCouponTemplatesDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '模板名 / 副标题模糊搜索' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  keyword?: string;

  @ApiPropertyOptional({ enum: ['MAIN_COUPON', 'SUB_COUPON'], description: '主体券 / 附属商家券' })
  @IsOptional()
  @IsIn(['MAIN_COUPON', 'SUB_COUPON'])
  ownerType?: OwnerTypeValue;

  @ApiPropertyOptional({
    enum: ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'VOID'],
    description: '模板状态',
  })
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'VOID'])
  status?: TemplateStatusValue;

  @ApiPropertyOptional({
    description: '按归属商家筛选；主体商家只能看自己拥有/自己创建的，附属商家只能看自己的',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  ownerMerchantId?: number;
}

export class CreateCouponTemplateDto {
  @ApiPropertyOptional({
    description: '创建者主体 id；**仅平台管理员可指定**，主体管理员传别人的值 403',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  mainMerchantId?: number;

  @ApiProperty({ enum: ['MAIN_COUPON', 'SUB_COUPON'], description: '券归属类型' })
  @IsIn(['MAIN_COUPON', 'SUB_COUPON'])
  ownerType!: OwnerTypeValue;

  @ApiPropertyOptional({
    description: '券归属商家 id；ownerType=SUB_COUPON 时必填，且必须是本主体的直接下属（已通过审核）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  ownerMerchantId?: number;

  @ApiProperty({ example: 'T5 新客专享券' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional({ example: '仅限新客首单使用' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  subtitle?: string;

  @ApiPropertyOptional({ enum: ['VOUCHER', 'DISCOUNT'], default: 'VOUCHER' })
  @IsOptional()
  @IsIn(['VOUCHER', 'DISCOUNT'])
  couponType: CouponTypeValue = 'VOUCHER';

  @ApiProperty({ description: '面值（元）', example: 20 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  faceValue!: number;

  @ApiPropertyOptional({ description: '使用门槛（元），0 表示无门槛', example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  thresholdAmount?: number;

  @ApiPropertyOptional({ description: '积分兑换所需积分', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pointsCost?: number;

  @ApiPropertyOptional({
    description: '是否参与积分兑换（商家自选开关）。关掉即从兑换商城下架，已发出的券不受影响',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  exchangeEnabled?: boolean;

  @ApiPropertyOptional({ description: '采购结算价（元）', example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchasePrice?: number;

  @ApiProperty({ description: '发行总量', example: 500 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalStock!: number;

  @ApiPropertyOptional({
    enum: ['FIXED', 'AFTER_RECEIVE_DAYS'],
    default: 'AFTER_RECEIVE_DAYS',
    description: 'FIXED 需传 validStart/validEnd；AFTER_RECEIVE_DAYS 需传 validDays',
  })
  @IsOptional()
  @IsIn(['FIXED', 'AFTER_RECEIVE_DAYS'])
  validType: ValidTypeValue = 'AFTER_RECEIVE_DAYS';

  @ApiPropertyOptional({ description: 'validType=FIXED 时的生效时间' })
  @IsOptional()
  @IsDateString()
  validStart?: string;

  @ApiPropertyOptional({ description: 'validType=FIXED 时的失效时间（必须晚于 validStart）' })
  @IsOptional()
  @IsDateString()
  validEnd?: string;

  @ApiPropertyOptional({ description: 'validType=AFTER_RECEIVE_DAYS 时的有效天数', example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  validDays?: number;

  @ApiPropertyOptional({
    enum: ['ALL_STORES', 'SPECIFIED_STORES', 'SPECIFIED_MERCHANTS'],
    default: 'ALL_STORES',
    description: 'SPECIFIED_MERCHANTS 为 S4 预留，S2.1 传了会 400',
  })
  @IsOptional()
  @IsIn(['ALL_STORES', 'SPECIFIED_STORES', 'SPECIFIED_MERCHANTS'])
  applyScope: ApplyScopeValue = 'ALL_STORES';

  @ApiPropertyOptional({
    description: 'applyScope=SPECIFIED_STORES 时必填，门店必须属于券的归属商家',
    example: [101],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  storeIds?: number[];

  @ApiPropertyOptional({ description: '每人限领/限用张数；0=不限', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  perUserLimit?: number;

  @ApiPropertyOptional({
    description: '核销时是否要求订单实付金额 > 面值（也可通过 rules 内 [ADV] 写入）',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  requireGreaterThanFace?: boolean;

  @ApiPropertyOptional({
    description:
      '高级适用范围 JSON（claimLimitMode/productScope/productIds/issueDeadline）；也可通过 rules 内 [ADV] 写入',
  })
  @IsOptional()
  applicableScope?: Record<string, unknown>;

  @ApiPropertyOptional({ example: '满 100 元可用，不兑现不找零' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;

  @ApiPropertyOptional({
    example: '同一订单仅可使用 1 张，不可叠加',
    description: '可含过渡期 [ADV]...[/ADV] 块，服务端会解析落库并剥离',
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  rules?: string;
}

export class UpdateCouponTemplateDto {
  @ApiPropertyOptional({ example: 'T5 新客专享券（改价）' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  subtitle?: string;

  @ApiPropertyOptional({ description: '面值（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  faceValue?: number;

  @ApiPropertyOptional({ description: '使用门槛（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  thresholdAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pointsCost?: number;

  @ApiPropertyOptional({ description: '是否参与积分兑换' })
  @IsOptional()
  @IsBoolean()
  exchangeEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchasePrice?: number;

  @ApiPropertyOptional({
    description: '发行总量：只能调大，且不能小于已发放数量 issuedCount',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalStock?: number;

  @ApiPropertyOptional({ enum: ['FIXED', 'AFTER_RECEIVE_DAYS'] })
  @IsOptional()
  @IsIn(['FIXED', 'AFTER_RECEIVE_DAYS'])
  validType?: ValidTypeValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  validDays?: number;

  @ApiPropertyOptional({ enum: ['ALL_STORES', 'SPECIFIED_STORES'] })
  @IsOptional()
  @IsIn(['ALL_STORES', 'SPECIFIED_STORES'])
  applyScope?: Exclude<ApplyScopeValue, 'SPECIFIED_MERCHANTS'>;

  @ApiPropertyOptional({ description: 'applyScope=SPECIFIED_STORES 时为门店清单（整体覆盖）' })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  storeIds?: number[];

  @ApiPropertyOptional({ description: '每人限领；0=不限' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  perUserLimit?: number;

  @ApiPropertyOptional({ description: '核销要求实付 > 面值' })
  @IsOptional()
  @IsBoolean()
  requireGreaterThanFace?: boolean;

  @ApiPropertyOptional({ description: '高级适用范围 JSON' })
  @IsOptional()
  applicableScope?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;

  @ApiPropertyOptional({ description: '可含过渡期 [ADV] 块' })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  rules?: string;
}
