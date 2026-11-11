import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/** 生成 / 重算某个自然月的商家互结清分账单 */
export class GenerateClearingDto {
  @ApiProperty({ description: '账期 YYYY-MM（北京时间自然月，按核销时间归期）', example: '2026-10' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: '账期格式应为 YYYY-MM' })
  periodKey: string;

  @ApiPropertyOptional({ description: 'true = 重算该月；已有账单已结算或账期已关闭时拒绝' })
  @IsOptional() @IsBoolean() recalculate?: boolean;
}

/** 清分账单列表查询 */
export class QueryClearingBillsDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 20;

  @ApiPropertyOptional({ description: '账期 YYYY-MM' })
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) periodKey?: string;

  @ApiPropertyOptional({ enum: ['UNSETTLED', 'SETTLED'] })
  @IsOptional() @IsIn(['UNSETTLED', 'SETTLED']) status?: 'UNSETTLED' | 'SETTLED';

  /** 平台可按商家筛选；商家账号会被强制限定为自己 */
  @ApiPropertyOptional({ description: '只看与该商家相关的账单（平台可用）' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) merchantId?: number;
}

/** 标记 / 撤销打款状态（仅平台） */
export class SettleClearingBillDto {
  @ApiProperty({ description: 'true = 标记已结算；false = 撤销回待结算' })
  @IsBoolean()
  settled: boolean;

  @ApiPropertyOptional({ description: '打款备注 / 流水号' })
  @IsOptional() @IsString() @MaxLength(255) remark?: string;
}
