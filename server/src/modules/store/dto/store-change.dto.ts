import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChangeStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/**
 * 门店可变更字段白名单（S5.3）
 *
 * 禁止变更：`id` / `code`（门店编码）/ `merchantId`（所属商家）/ `status`（门店状态）。
 * 服务层会额外检查请求体是否夹带禁止字段 → 400（全局 ValidationPipe 只做剥离，不报错）。
 */
export const CHANGEABLE_FIELDS = [
  'name',
  'contactName',
  'contactPhone',
  'province',
  'city',
  'district',
  'address',
  'lng',
  'lat',
  'businessHours',
  'logo',
] as const;

export const FORBIDDEN_FIELDS = ['id', 'code', 'merchantId', 'storeId', 'status'] as const;

export class CreateStoreChangeDto {
  @ApiPropertyOptional({ description: '门店名称' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactName?: string;

  @ApiPropertyOptional({ description: '联系电话（手机 / 座机）' })
  @IsOptional()
  @Matches(/^[0-9+\-() ]{6,20}$/, { message: '联系电话格式不正确' })
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  province?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  district?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ description: '经度 (-180 ~ 180)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '经度必须是数字' })
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ description: '纬度 (-90 ~ 90)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '纬度必须是数字' })
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ description: '营业时间，如 09:00-22:00' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessHours?: string;

  @ApiPropertyOptional({ description: '门店 Logo URL' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  logo?: string;

  @ApiPropertyOptional({ description: '申请说明（可选）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class ReviewStoreChangeDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'], description: '通过 / 驳回' })
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({ description: '审核备注；**驳回时必填**' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;
}

export class QueryStoreChangeDto {
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

  @ApiPropertyOptional({ enum: ChangeStatus })
  @IsOptional()
  @IsEnum(ChangeStatus)
  status?: ChangeStatus;

  @ApiPropertyOptional({ description: '按门店过滤' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  storeId?: number;

  @ApiPropertyOptional({ description: '按商家过滤（平台用）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  merchantId?: number;
}
