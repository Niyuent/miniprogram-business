import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const PLAN_TYPES = ['MAIN_MEMBER', 'SUB_TIER'] as const;
const PERIODS = ['MONTH', 'QUARTER', 'HALF_YEAR', 'YEAR'] as const;
const TIERS = ['PRIMARY', 'ADVANCED'] as const;
const STATUSES = ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED'] as const;

export class SubmitSubscriptionDto {
  @ApiProperty({ enum: PLAN_TYPES, description: 'MAIN_MEMBER 主体会员 / SUB_TIER 附属档位' })
  @IsIn(PLAN_TYPES as unknown as string[])
  planType: (typeof PLAN_TYPES)[number];

  @ApiPropertyOptional({ enum: PERIODS, description: '周期：主体会员必填，附属档位固定 MONTH' })
  @IsOptional()
  @IsIn(PERIODS as unknown as string[])
  period?: (typeof PERIODS)[number];

  @ApiPropertyOptional({ enum: TIERS, description: '档位：附属档位必填（初级免费，无需提交）' })
  @IsOptional()
  @IsIn(TIERS as unknown as string[])
  tier?: (typeof TIERS)[number];

  @ApiPropertyOptional({ description: '备注（付款方式、流水号等，便于后台核对）' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;

  @ApiPropertyOptional({ description: '商家 id（平台代提交时使用；商家账号忽略）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  merchantId?: number;
}

export class ConfirmSubscriptionDto {
  @ApiPropertyOptional({ description: '收款备注（线下凭证号等）' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  payRemark?: string;
}

export class QuerySubscriptionsDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 20;
  @ApiPropertyOptional({ enum: PLAN_TYPES })
  @IsOptional()
  @IsIn(PLAN_TYPES as unknown as string[])
  planType?: (typeof PLAN_TYPES)[number];
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES as unknown as string[])
  status?: (typeof STATUSES)[number];
  @ApiPropertyOptional({ description: '按商家筛选（平台/主体可用）' })
  @IsOptional() @Type(() => Number) @IsInt() merchantId?: number;
}
