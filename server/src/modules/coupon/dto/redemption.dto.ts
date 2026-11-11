import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { PageQueryDto } from './coupon-template.dto';

/** 核销渠道：MANUAL=手输券码，SCAN=扫码，API=开放接口 */
export type ChannelValue = 'MANUAL' | 'SCAN' | 'API';

/** 核销记录状态 */
export type RedemptionStatusValue = 'SUCCESS' | 'REVERSED';

/**
 * 核销前置校验（**只读**，不写任何库表）
 *
 * - `storeId`：店员账号可省略（取 JWT 上的门店）；商家账号必传。
 * - `userId`：H5 自助核销场景传，校验「券属于当前用户」；门店收银场景不传。
 * - `orderNo` / `orderAmount`：传了才校验「一单一券」与「满减门槛」。
 */
export class VerifyCouponDto {
  @ApiProperty({ description: '券码（12 位）', example: 'ASD5R3U3RWTM' })
  @IsString()
  @Length(12, 32)
  code!: string;

  @ApiPropertyOptional({ description: '核销门店 id；店员可省略（默认 JWT 门店）', example: 101 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  storeId?: number;

  @ApiPropertyOptional({ description: 'C 端用户 id（H5 场景校验券归属）', example: 1001 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId?: number;

  @ApiPropertyOptional({ description: '订单号（校验「一单一券」）', example: 'ORD20260101002' })
  @IsOptional()
  @IsString()
  @Length(4, 32)
  orderNo?: string;

  @ApiPropertyOptional({ description: '订单金额（校验满减门槛 / 实付>面值）', example: 128 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  orderAmount?: number;

  @ApiPropertyOptional({
    description: '本单商品 ID 列表（校验指定商品可用 / 排除特价商品时传入）',
    example: ['SKU-001', 'SKU-002'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  productIds?: string[];
}

/**
 * 执行核销
 *
 * `orderNo` **必填**：核销必须挂在真实订单上（H3 一单一券靠订单上的唯一索引兜底）。
 * 订单不存在时按 `orderNo` 创建一张 CONSUME 订单（收银台先核销后结账的场景）；
 * 订单已存在则复用，并校验它还没绑定别的券。
 */
export class CreateRedemptionDto extends VerifyCouponDto {
  @ApiProperty({ description: '订单号（核销必须挂订单；不存在则按此单号创建消费订单）', example: 'ORD-S23-001' })
  @IsString()
  @Length(4, 32)
  declare orderNo: string;

  @ApiPropertyOptional({ description: '核销渠道', enum: ['MANUAL', 'SCAN', 'API'], example: 'MANUAL' })
  @IsOptional()
  @IsIn(['MANUAL', 'SCAN', 'API'])
  channel?: ChannelValue;

  @ApiPropertyOptional({ description: '订单来源（建单用）', enum: ['APPLET', 'WEB', 'IMPORT'], example: 'WEB' })
  @IsOptional()
  @IsIn(['APPLET', 'WEB', 'IMPORT'])
  orderSource?: 'APPLET' | 'WEB' | 'IMPORT';

  @ApiPropertyOptional({ description: '核销备注（写进审计 after）' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  remark?: string;

  @ApiPropertyOptional({
    description:
      '幂等键：前端一次确认生成一个（建议用 utils/idem 的 genRequestId）。同键重试返回首次核销结果（idempotent:true），不会重复核销',
    example: 'r17300000000001234',
  })
  @IsOptional()
  @IsString()
  @Length(4, 64)
  requestId?: string;
}

export class QueryRedemptionsDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '券码（模糊）' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  code?: string;

  @ApiPropertyOptional({ description: '券模板 id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  templateId?: number;

  @ApiPropertyOptional({ description: 'C 端用户 id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId?: number;

  @ApiPropertyOptional({ description: '门店 id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  storeId?: number;

  @ApiPropertyOptional({ description: '按商家筛选；附属商家只能传自己，传别人 403' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  merchantId?: number;

  @ApiPropertyOptional({ enum: ['SUCCESS', 'REVERSED'] })
  @IsOptional()
  @IsEnum(['SUCCESS', 'REVERSED'] as unknown as object)
  status?: RedemptionStatusValue;

  @ApiPropertyOptional({ description: '核销时间起点（含）' })
  @IsOptional()
  @IsDateString()
  redeemedFrom?: string;

  @ApiPropertyOptional({ description: '核销时间终点（含）' })
  @IsOptional()
  @IsDateString()
  redeemedTo?: string;
}

/**
 * 冲正：把核销记录置为 REVERSED，并把券恢复成未使用
 *
 * `reason` **必填且不少于 5 个字符** —— 冲正是资金相关操作，
 * 必须留下可读的原因（"误核销"、"用户取消订单"），不能是一串无意义的字符。
 * 原因同时写入 `redemption_records.reverseReason` 与审计日志 `after`。
 */
export class ReverseRedemptionDto {
  @ApiProperty({ description: '冲正原因（≥5 字符，写入核销记录与审计）', example: '订单取消，券退回用户' })
  @IsString()
  @Length(5, 500)
  reason!: string;
}
