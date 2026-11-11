import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

/** 六张报表 key（与 `/reports/:key` 一一对应，也是导出接口的 key） */
export const REPORT_KEYS = [
  'merchant-onboarding',
  'orders-summary',
  'coupon-summary',
  'points-summary',
  'store-settlement',
  'authorization-logs',
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

/** 报表通用筛选：时间范围 + 商家 + 分页（导出时同样生效，保证「看什么导什么」） */
export class ReportQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;

  @ApiPropertyOptional({ description: '每页条数，1-200' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 20;

  @ApiPropertyOptional({ description: '开始时间（ISO8601），按各报表的主时间字段过滤' })
  @IsOptional() @IsISO8601() from?: string;

  @ApiPropertyOptional({ description: '结束时间（ISO8601）' })
  @IsOptional() @IsISO8601() to?: string;

  @ApiPropertyOptional({ description: '商家 id；附属身份会被强制收敛为自己的商家' })
  @IsOptional() @Type(() => Number) @IsInt() merchantId?: number;
}

/** 工作台趋势图：近 N 天 */
export class TrendQueryDto {
  @ApiPropertyOptional({ description: '天数，1-90，默认 7' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days = 7;
}

export class ReportKeyParamDto {
  @ApiPropertyOptional({ enum: REPORT_KEYS, description: '报表 key' })
  @IsIn(REPORT_KEYS as unknown as string[])
  key: string;
}
