import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class GenerateSettlementDto {
  @ApiProperty({ description: '对账商家 id（附属）；平台/主体可为 null 表示全平台' })
  @IsOptional() @Type(() => Number) @IsInt() merchantId?: number | null;

  @ApiProperty({ description: '周期开始（ISO8601）' })
  @IsISO8601() periodStart: string;

  @ApiProperty({ description: '周期结束（ISO8601）' })
  @IsISO8601() periodEnd: string;
}

export class QuerySettlementsDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 10;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() merchantId?: number;
  @ApiPropertyOptional({ enum: ['GENERATING', 'GENERATED', 'CONFIRMED', 'DISPUTED'] })
  @IsOptional() @IsIn(['GENERATING', 'GENERATED', 'CONFIRMED', 'DISPUTED']) status?: string;

  // 账期筛选（S4.2 收口：从前端过滤挪到后端）。传 YYYY-MM 的月份时，
  // 前端按 UTC 展开成当月 1 日 ~ 次月 1 日，命中该月账期的账单。
  @ApiPropertyOptional({ description: '账期开始下限（ISO8601）：periodStart >= 该值' })
  @IsOptional() @IsISO8601() periodStart?: string;

  @ApiPropertyOptional({ description: '账期结束上限（ISO8601）：periodEnd <= 该值' })
  @IsOptional() @IsISO8601() periodEnd?: string;
}

export class ConfirmSettlementDto {
  @ApiProperty({ description: 'true=确认(CONFIRMED)；false=提异议(DISPUTED，disputeReason 必填)' })
  // 必须有校验装饰器：全局 ValidationPipe 开了 whitelist:true，
  // 无装饰器的属性会被剥离成 undefined —— 曾导致 confirm:true 也被判为「提异议」而要求填原因。
  @IsBoolean()
  confirm: boolean;

  @ApiPropertyOptional({ description: '提异议原因（confirm=false 时必填，≥5 字符）' })
  @IsOptional() @IsString() @MaxLength(500) disputeReason?: string;
}
