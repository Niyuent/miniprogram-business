import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/** 快速建券并发放（小程序商家端） */
export class QuickIssueDto {
  @ApiPropertyOptional({ example: '自定义发放', description: '券名称；缺省按面值/门槛或兑换物自动生成' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({
    enum: ['VOUCHER', 'ITEM'],
    default: 'VOUCHER',
    description: 'VOUCHER=金额减免券；ITEM=到店兑换指定物品',
  })
  @IsOptional()
  @IsIn(['VOUCHER', 'ITEM'])
  benefitType?: 'VOUCHER' | 'ITEM';

  @ApiPropertyOptional({
    example: '拿铁一杯',
    description: 'benefitType=ITEM 时必填：可兑换的具体物品',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  itemName?: string;

  @ApiPropertyOptional({
    example: 15,
    description: '面值（元）。VOUCHER 必填且上限 500；ITEM 可选（参考价值，默认 0）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(500)
  faceValue?: number;

  @ApiPropertyOptional({ example: 0, description: '使用门槛，0=无门槛（兑换物券固定为 0）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  thresholdAmount?: number;

  @ApiPropertyOptional({
    example: 0,
    description:
      '积分兑换所需积分；>0 时该券进入积分兑换商城，会员花 N 积分兑换此券；0=不进兑换商城（仅按所选对象直接发放）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  pointsCost?: number;

  @ApiPropertyOptional({
    description: '是否上架积分兑换商城；不传默认 true（有积分价时必上架，无积分价时不影响直接发放）',
  })
  @IsOptional()
  @IsBoolean()
  exchangeEnabled?: boolean;

  @ApiPropertyOptional({ example: 7, description: '领取后有效天数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  validDays?: number;

  @ApiProperty({ example: 100, description: '发行总量（同时预生成等量券码）' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  totalStock!: number;

  @ApiPropertyOptional({
    description:
      '投放联盟 id：券进入该联盟的积分商城。桥店（同时属于多个联盟）用它消歧；' +
      '不传时由「适用商家」共同所属的联盟推导。必须是适用商家所在的联盟',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  allianceId?: number;

  @ApiPropertyOptional({
    description: '发放商家范围（主体可选多家；附属只能本店）',
    type: [Number],
    example: [1, 2],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  targetMerchantIds?: number[];

  @ApiPropertyOptional({
    enum: ['USER', 'MERCHANT_VISITORS'],
    description: '立即发放对象；缺省只建券不上人',
  })
  @IsOptional()
  @IsIn(['USER', 'MERCHANT_VISITORS'])
  audience?: 'USER' | 'MERCHANT_VISITORS';

  @ApiPropertyOptional({ description: 'audience=USER 时的会员 id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId?: number;

  @ApiPropertyOptional({ description: 'audience=USER 时可用手机号替代 userId' })
  @IsOptional()
  @IsString()
  @Length(11, 11)
  phone?: string;

  @ApiPropertyOptional({ description: '每人发放张数（默认 1，上限 50）', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;

  @ApiPropertyOptional({
    description: '每人限兑张数（0 = 不限领；对积分兑换商城的券生效）',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  perUserLimit?: number;

  @ApiPropertyOptional({ description: '主体：是否发全体联盟商家' })
  @IsOptional()
  allMerchants?: boolean;
}
