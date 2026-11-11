import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/** 分页查询基类：page / pageSize */
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

/** 授权类型：目前只有「发放主体商家代金券」一种 */
export type AuthorizationType = 'ISSUE_MAIN_COUPON';

/** 授权范围：全部主体券 / 指定券模板 */
export type TemplateScopeValue = 'ALL' | 'SPECIFIED';

export class CreateAuthorizationDto {
  @ApiPropertyOptional({
    description: '主体商家 id；**仅平台管理员可指定**，主体管理员传别人的值会被拒绝',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  mainMerchantId?: number;

  @ApiProperty({ description: '被授权的附属商家 id（必须是该主体的直接下属且已通过审核）' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  subMerchantId!: number;

  @ApiPropertyOptional({ enum: ['ISSUE_MAIN_COUPON'], default: 'ISSUE_MAIN_COUPON' })
  @IsOptional()
  @IsIn(['ISSUE_MAIN_COUPON'])
  authType: AuthorizationType = 'ISSUE_MAIN_COUPON';

  @ApiProperty({
    enum: ['ALL', 'SPECIFIED'],
    description: 'ALL=全部主体券；SPECIFIED=仅限 templates[] 内的模板',
  })
  @IsIn(['ALL', 'SPECIFIED'])
  templateScope!: TemplateScopeValue;

  @ApiPropertyOptional({
    description: 'templateScope=SPECIFIED 时必填且不可为空；ALL 时忽略',
    example: [1, 2],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  templateIds?: number[];
}

export class DisableAuthorizationDto {
  @ApiPropertyOptional({ description: '关闭原因（写入 revoke_reason，报表可追溯）' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  revokeReason?: string;
}

export class QueryAuthorizationsDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '按被授权商家筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  subMerchantId?: number;

  @ApiPropertyOptional({ enum: ['ENABLED', 'DISABLED'], description: '按授权状态筛选' })
  @IsOptional()
  @IsIn(['ENABLED', 'DISABLED'])
  status?: string;
}

export class QueryAuthorizationLogsDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '仅平台管理员可指定其它主体' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  mainMerchantId?: number;

  @ApiPropertyOptional({ description: '只看该附属商家的授权记录' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  subMerchantId?: number;

  @ApiPropertyOptional({ enum: ['authorization:grant', 'authorization:revoke'] })
  @IsOptional()
  @IsIn(['authorization:grant', 'authorization:revoke'])
  action?: string;

  @ApiPropertyOptional({ description: '起始时间（ISO8601）', example: '2026-10-01T00:00:00+08:00' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: '截止时间（ISO8601）' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/**
 * GET /me/authorizations 的查询参数
 *
 * 这个接口的定位是「附属商家查自己的授权状态」，**任何**企图指定他人身份的参数
 * 都会被判越权 403 —— 而不是被静默忽略。静默忽略会让调用方误以为传参生效了。
 */
export class QueryMeAuthorizationsDto {
  @ApiPropertyOptional({ description: '只能是自己的 merchantId，否则 403' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  merchantId?: number;

  @ApiPropertyOptional({ description: '只能是自己的 merchantId，否则 403' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  subMerchantId?: number;

  @ApiPropertyOptional({ description: '只能是自己的上级主体，否则 403' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  mainMerchantId?: number;
}
