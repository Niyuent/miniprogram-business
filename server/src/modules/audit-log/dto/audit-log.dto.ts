import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** 分页查询基类：page / pageSize（与 merchant / authorization 模块保持同一约定） */
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

/**
 * GET /audit-logs 查询参数
 *
 * `module` / `operatorId` / `action` / 时间范围都可以单独或组合使用；
 * 数据可见范围由 `AuditService.visibilityWhere()` 强制收敛，
 * **不接受**任何「看别人家日志」的入参组合。
 */
export class QueryAuditLogsDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: '业务模块过滤，如 merchant / authorization / auth',
    example: 'authorization',
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  module?: string;

  @ApiPropertyOptional({ description: '按操作人 id 精确过滤' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  operatorId?: number;

  @ApiPropertyOptional({ description: '按操作人姓名/账号模糊过滤（operatorName OR adminUser.username）' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  operatorKeyword?: string;

  @ApiPropertyOptional({
    description: '按动作过滤，如 application:approve / authorization:revoke / merchant:suspend',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  action?: string;

  @ApiPropertyOptional({ description: '按目标类型过滤，如 merchant / merchant_authorization' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  targetType?: string;

  @ApiPropertyOptional({ description: '按目标 id 过滤' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId?: number;

  @ApiPropertyOptional({ enum: ['SUCCESS', 'FAILED'], description: '按执行结果过滤' })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  result?: string;

  @ApiPropertyOptional({ description: '起始时间（ISO8601）', example: '2026-10-01T00:00:00+08:00' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: '截止时间（ISO8601）' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
