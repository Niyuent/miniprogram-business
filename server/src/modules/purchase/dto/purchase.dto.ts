import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class QueryPurchasesDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 10;
  @ApiPropertyOptional({ description: '按附属商家筛选（越权 → 403）' })
  @IsOptional() @Type(() => Number) @IsInt() subMerchantId?: number;
  @ApiPropertyOptional({ enum: ['UNSETTLED', 'SETTLED'] })
  @IsOptional() @IsIn(['UNSETTLED', 'SETTLED']) settleStatus?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
}

export class CreatePurchaseDto {
  @ApiProperty({ description: '附属商家 id（主体/平台采购方指定；附属录单时忽略）' })
  @IsOptional() @Type(() => Number) @IsInt() subMerchantId?: number;

  @ApiPropertyOptional({ description: '主体商家 id（平台/附属录单时必填；主体录单时忽略）' })
  @IsOptional() @Type(() => Number) @IsInt() mainMerchantId?: number;

  @ApiProperty({ description: '券模板 id' })
  @Type(() => Number) @IsInt() templateId: number;

  @ApiProperty({ description: '采购数量' })
  @Type(() => Number) @IsInt() @Min(1) quantity: number;

  @ApiProperty({ description: '单价' })
  @Type(() => Number) @Min(0) unitPrice: number;

  @ApiPropertyOptional({ description: '总金额（缺省 = 数量 × 单价）' })
  @IsOptional() @Type(() => Number) @Min(0) totalAmount?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() purchasedAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) remark?: string;
}

export class SettlePurchaseDto {
  @ApiPropertyOptional({ description: '结算备注' })
  @IsOptional() @IsString() @MaxLength(255) settleRemark?: string;
}
