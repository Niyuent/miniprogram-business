import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** 异常订单类型（对应 orders.abnormalType） */
export const ABNORMAL_TYPES = ['AMOUNT_ERROR', 'DUPLICATE_COUPON', 'REFUND_NOT_RETURNED', 'STORE_DISPUTE'] as const;

/** 异常处理类型（POST /orders/:id/handle） */
export const HANDLE_TYPES = ['CANCEL', 'AMOUNT_ERROR', 'DISPUTE'] as const;

export class QueryOrdersDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 10;
  @ApiPropertyOptional({ enum: ['NORMAL', 'ABNORMAL', 'REFUNDED', 'CANCELED'] })
  @IsOptional() @IsIn(['NORMAL', 'ABNORMAL', 'REFUNDED', 'CANCELED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() orderNo?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() userId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() merchantId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() storeId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
}

export class CreateOrderDto {
  @ApiProperty({ description: '订单号（唯一，一单只送一次积分靠它做幂等键）' })
  @IsString() @MaxLength(32) orderNo: string;

  @ApiProperty({ description: '用户 id' })
  @Type(() => Number) @IsInt() userId: number;

  @ApiPropertyOptional({ description: '商家 id（平台管理员补录必填）' })
  @IsOptional() @Type(() => Number) @IsInt() merchantId?: number;

  @ApiPropertyOptional({ description: '门店 id' })
  @IsOptional() @Type(() => Number) @IsInt() storeId?: number;

  @ApiPropertyOptional({ enum: ['CONSUME', 'EXCHANGE'], default: 'CONSUME' })
  @IsOptional() @IsIn(['CONSUME', 'EXCHANGE']) orderType?: 'CONSUME' | 'EXCHANGE';

  @ApiProperty({ description: '订单总金额' })
  @Type(() => Number) @Min(0) totalAmount: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) discountAmount?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(0) payAmount?: number;

  @ApiPropertyOptional({ enum: ['APPLET', 'WEB', 'IMPORT'], default: 'IMPORT' })
  @IsOptional() @IsIn(['APPLET', 'WEB', 'IMPORT']) source?: 'APPLET' | 'WEB' | 'IMPORT';

  @ApiPropertyOptional({ description: '消费金额（>0 时走 /points/earn 送积分）' })
  @IsOptional() @Type(() => Number) @Min(0) amount?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) remark?: string;
}

export class MarkAbnormalDto {
  @ApiProperty({ enum: ABNORMAL_TYPES, description: '异常类型' })
  @IsIn(ABNORMAL_TYPES) abnormalType: (typeof ABNORMAL_TYPES)[number];

  @ApiProperty({ description: '异常说明（必填，≥5 字符）' })
  @IsString() @MaxLength(500) abnormalRemark: string;
}

export class HandleOrderDto {
  @ApiProperty({ enum: HANDLE_TYPES, description: '处理类型' })
  @IsIn(HANDLE_TYPES) handleType: (typeof HANDLE_TYPES)[number];

  @ApiPropertyOptional({ description: '处理结果说明' })
  @IsOptional() @IsString() @MaxLength(500) result?: string;
}
