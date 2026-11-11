import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, Length, Max, Min } from 'class-validator';
import { PageQueryDto } from './coupon-template.dto';

/** 券码状态（对应 Prisma CouponCodeStatus） */
export type CodeStatusValue = 'UNISSUED' | 'ISSUED' | 'REDEEMED' | 'VOID';

/**
 * 券码预生成
 *
 * `batchNo` 不传时由后端按 `{templateId}-{yyyymmdd}-{seq}` 生成（seq 为该模板当日批次序号，3 位补零）。
 */
export class GenerateCodesDto {
  @ApiPropertyOptional({
    description: '批次号，不传则自动生成 1001-20261007-001 形式；已存在则返回 409 BATCH_ALREADY_EXISTS',
    example: '1001-20261007-001',
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  batchNo?: string;

  @ApiProperty({ description: '生成数量', example: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  quantity!: number;

  @ApiPropertyOptional({ description: '批次备注（如：双十一预热）' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  remark?: string;
}

export class QueryCodesDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['UNISSUED', 'ISSUED', 'REDEEMED', 'VOID'] })
  @IsOptional()
  @IsIn(['UNISSUED', 'ISSUED', 'REDEEMED', 'VOID'])
  status?: CodeStatusValue;

  @ApiPropertyOptional({ description: '按批次号精确过滤' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  batchNo?: string;

  @ApiPropertyOptional({ description: '按批次 id 精确过滤（与 batchNo 等价，前端下拉直接用 id）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  batchId?: number;

  @ApiPropertyOptional({ description: '按券码模糊搜索' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  code?: string;

  @ApiPropertyOptional({ description: '是否返回券码明文；false 时仅返回 id + 状态（导出场景用）' })
  @IsOptional()
  @Type(() => Boolean)
  withCode?: boolean;
}

export class QueryBatchesDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '模板 id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  templateId?: number;
}
