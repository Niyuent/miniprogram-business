import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ChatDto {
  @ApiProperty({ example: '我昨天赚了多少' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message!: string;

  @ApiPropertyOptional({ description: '会话 id；不传则新建' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;
}

export class BusinessSummaryQueryDto {
  @ApiPropertyOptional({ example: '2026-10-25' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-25' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ enum: ['prev_period', 'prev_month'], default: 'prev_period' })
  @IsOptional()
  @IsString()
  compare?: 'prev_period' | 'prev_month';
}

export class CouponPerformanceQueryDto {
  @ApiPropertyOptional({ default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  days?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class LostMembersQueryDto {
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AbnormalMerchantsQueryDto {
  @ApiPropertyOptional({ default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  hours?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
