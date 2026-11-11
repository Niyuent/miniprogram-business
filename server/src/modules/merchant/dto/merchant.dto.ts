import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

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

export class QueryMerchantsDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'],
    description: '按状态筛选',
  })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'])
  status?: string;

  @ApiPropertyOptional({ enum: ['MAIN', 'SUB'], description: '按类型筛选' })
  @IsOptional()
  @IsIn(['MAIN', 'SUB'])
  type?: string;

  @ApiPropertyOptional({ description: '按名称/编码模糊搜索' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  keyword?: string;
}

export class UpdateMerchantStatusDto {
  @ApiProperty({
    enum: ['APPROVED', 'SUSPENDED'],
    description: '启用(APPROVED) / 暂停(SUSPENDED)；入驻审核请用 /applications 的 approve/reject',
  })
  @IsIn(['APPROVED', 'SUSPENDED'])
  status: 'APPROVED' | 'SUSPENDED';

  @ApiPropertyOptional({ description: '变更原因，暂停时建议填写' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  remark?: string;
}

/** 加入联盟（附属身份） */
export class JoinAllianceDto {
  @ApiProperty({ description: '目标联盟 id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  allianceId: number;
}
