import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
import { PageQueryDto } from './coupon-template.dto';

/** 券实例状态（对应 Prisma CouponInstanceStatus） */
export type InstanceStatusValue = 'UNUSED' | 'USED' | 'EXPIRED' | 'FROZEN';

/** 券来源（S2.2 发放固定 MERCHANT_ISSUE，兑换走 S3） */
export type SourceValue = 'EXCHANGE' | 'MERCHANT_ISSUE' | 'GIFT';

/**
 * 券实例发放
 *
 * 身份与发券方由 JWT 推导：
 * - 主体商家账号：`merchantId` 即发券方，只能发自己拥有 / 自己创建的券；
 * - 附属商家账号：发的是**主体券**，必须走 `checkAuthorization`（H2 三重校验）；
 * - 平台管理员：可用 `merchantId` 指定以哪个商家的身份发放。
 */
export class IssueCouponDto {
  @ApiProperty({ description: '券模板 id', example: 1001 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  templateId!: number;

  @ApiPropertyOptional({ description: 'C 端用户 id；与 phone 二选一', example: 1001 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId?: number;

  @ApiPropertyOptional({ description: 'C 端手机号；与 userId 二选一', example: '13800138001' })
  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;

  @ApiPropertyOptional({ description: '发放数量，默认 1，单次最多 50', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;

  @ApiPropertyOptional({
    description:
      '发券商家身份：平台可任意指定；主体可指定自己或直属附属；附属传了也只能是自己（否则忽略/拒绝）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  merchantId?: number;

  @ApiPropertyOptional({
    description: '发放范围商家 id 列表（主体可选联盟内商家；附属只能本店）。与 allMerchants 二选一优先 all',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  targetMerchantIds?: number[];

  @ApiPropertyOptional({ description: '是否对联盟全体商家生效范围（仅主体）', default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allMerchants?: boolean;

  @ApiPropertyOptional({
    description: 'USER=指定会员；MERCHANT_VISITORS=所选商家到店会员批量发（默认 USER）',
    enum: ['USER', 'MERCHANT_VISITORS'],
  })
  @IsOptional()
  @IsIn(['USER', 'MERCHANT_VISITORS'])
  audience?: 'USER' | 'MERCHANT_VISITORS';

  @ApiPropertyOptional({ description: '发放备注（写进审计 after）' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  remark?: string;
}

export class QueryInstancesDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '按券模板筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  templateId?: number;

  @ApiPropertyOptional({ description: '按 C 端用户筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId?: number;

  @ApiPropertyOptional({ enum: ['UNUSED', 'USED', 'EXPIRED', 'FROZEN'] })
  @IsOptional()
  @IsIn(['UNUSED', 'USED', 'EXPIRED', 'FROZEN'])
  status?: InstanceStatusValue;

  @ApiPropertyOptional({ description: '按发放商家筛选；附属商家只能传自己，传别人 403' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  issuerMerchantId?: number;

  @ApiPropertyOptional({ description: '券码精确/模糊查询' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  code?: string;

  @ApiPropertyOptional({ description: '有效期起点（含）' })
  @IsOptional()
  @IsDateString()
  expireFrom?: string;

  @ApiPropertyOptional({ description: '有效期终点（含）' })
  @IsOptional()
  @IsDateString()
  expireTo?: string;
}

/** 冻结 / 解冻：frozen=true 冻结，false 解冻 */
export class FreezeInstanceDto {
  @ApiProperty({ description: 'true=冻结，false=解冻', example: true })
  @Type(() => Boolean)
  @IsBoolean()
  frozen!: boolean;

  @ApiPropertyOptional({ description: '冻结原因（写进审计）' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  reason?: string;
}
