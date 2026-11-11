import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/** 用户列表查询（分页 + 筛选） */
export class QueryUsersDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  /** 手机号（模糊） */
  @ApiPropertyOptional({ description: '手机号（模糊匹配）' })
  @IsOptional()
  @IsString()
  phone?: string;

  /** 昵称/手机号模糊关键词 */
  @ApiPropertyOptional({ description: '昵称 / 手机号 模糊关键词' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /** 注册时间起（YYYY-MM-DD 或 ISO） */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  registeredFrom?: string;

  /** 注册时间止 */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  registeredTo?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: UserStatus, description: 'ACTIVE 启用 / DISABLED 禁用' })
  @IsEnum(UserStatus)
  status!: UserStatus;
}

export class BindPhoneDto {
  @ApiProperty({ example: '13800000000' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;
}
