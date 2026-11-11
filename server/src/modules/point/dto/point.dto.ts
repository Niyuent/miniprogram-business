import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
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
import { PageQueryDto } from '../../coupon/dto/coupon-template.dto';
import { PointTxnType } from '@prisma/client';

// ---------------------------------------------------------------- 查询

/** 积分账户列表 */
export class QueryPointAccountsDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '用户昵称 / 手机号模糊搜索' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  keyword?: string;

  @ApiPropertyOptional({ description: '余额下限（含）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minBalance?: number;

  @ApiPropertyOptional({ description: '仅看有临期积分（30 天内过期）的账户' })
  @IsOptional()
  @Type(() => Boolean)
  expiringSoon?: boolean;
}

/** 积分流水列表 */
export class QueryPointTransactionsDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '按用户过滤' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId?: number;

  @ApiPropertyOptional({ enum: PointTxnType, description: '流水类型：EARN/SPEND/EXPIRE/REFUND/ADJUST' })
  @IsOptional()
  @IsIn(['EARN', 'SPEND', 'EXPIRE', 'REFUND', 'ADJUST'])
  type?: PointTxnType;

  @ApiPropertyOptional({ description: '按产生积分的商家过滤（越权 → 403 FORBIDDEN_SCOPE）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  merchantId?: number;

  @ApiPropertyOptional({ description: '按门店过滤' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  storeId?: number;

  @ApiPropertyOptional({ description: '开始日期（含），yyyy-mm-dd' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: '结束日期（含），yyyy-mm-dd' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

// ---------------------------------------------------------------- 写操作

/**
 * 消费录单送积分
 *
 * 这是**内部接口**：S3.4 的订单模块创建 CONSUME 订单后会调它。
 * 之所以先做成独立 HTTP 接口而不是纯 service 调用：核销 / 补录 / 后台录单都要走，
 * 且需要「同一订单只送一次」的幂等语义——HTTP 层与内部调用共用同一份实现，口径不会漂。
 */
export class EarnPointsDto {
  @ApiProperty({ example: 1001, description: '积分归属用户' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId: number;

  @ApiProperty({ example: 128, description: '消费金额（元），按积分规则 earnRatio 折算' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  amount: number;

  @ApiPropertyOptional({ description: '订单 id。传入即启用「一单只送一次积分」幂等；与 orderNo / requestId 二选一即可' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  orderId?: number;

  @ApiPropertyOptional({ description: '订单号（未传 orderId 时用它查订单，同样参与幂等）' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  orderNo?: string;

  @ApiProperty({
    example: 1,
    description: '发放到哪个联盟的积分池（必填）。商家必须属于该联盟。',
  })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  allianceId!: number;

  @ApiPropertyOptional({
    description:
      '扫码录单防重键。与 allianceId 组合幂等（同 requestId 不同联盟视为不同请求）。未传 orderId/orderNo 时用于自动建消费订单。',
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  requestId?: string;

  @ApiPropertyOptional({ description: '产生消费的商家（平台管理员必传；商家/店员由 JWT 推导）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  merchantId?: number;

  @ApiPropertyOptional({ description: '产生消费的门店（店员账号由 JWT 推导，传错 → 403 STORE_NOT_OWNED）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  storeId?: number;

  @ApiPropertyOptional({ description: '备注，写入流水 remark' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string;
}

/** 人工调整积分 */
export class AdjustPointsDto {
  @ApiProperty({ example: 1001 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId: number;

  @ApiProperty({
    example: -50,
    description: '调整积分，**带符号**：正数增加、负数扣减（扣减按 FIFO 走，过期批次不可用）',
  })
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  amount: number;

  @ApiProperty({ example: '客诉补偿：系统故障导致少算积分', description: '调整原因（≥5 字符），写入流水 remark + 审计日志' })
  @IsString()
  @Length(5, 255)
  reason: string;

  @ApiPropertyOptional({ description: '正向调整时指定该批次有效期；不传则按积分规则计算' })
  @IsOptional()
  @IsDateString()
  expireAt?: string;
}

/**
 * 积分兑换代金券
 *
 * `requestId` 是**幂等键**（前端生成 UUID）：同一用户重复提交同一 requestId 时，
 * 后端返回上次的结果（200 + `idempotent:true`），而不是再换一张券。
 */
export class ExchangePointsDto {
  @ApiProperty({ example: 1001, description: '兑换用户（H5 为当前用户，后台可代客兑换）' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId: number;

  @ApiProperty({
    example: 1,
    description: '从哪个联盟积分池扣减（必填）。必须与券模板所属 allianceId 一致。',
  })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  allianceId!: number;

  @ApiProperty({ example: 1001, description: '要兑换的券模板' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  templateId: number;

  @ApiProperty({ example: 'b3f1c2d4-...', description: '幂等键（UUID），重复提交返回上次结果' })
  @IsString()
  @Length(8, 64)
  requestId: string;

  @ApiPropertyOptional({ enum: ['H5', 'WEB'], description: '兑换渠道' })
  @IsOptional()
  @IsIn(['H5', 'WEB'])
  channel?: 'H5' | 'WEB';

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string;
}

/** 可兑商品清单查询 */
export class QueryExchangeOptionsDto {
  @ApiProperty({ example: 1001, description: '兑换用户（H5 为当前用户，后台可代客查看）' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId: number;

  @ApiPropertyOptional({
    example: 1,
    description: '联盟；不传则取该用户最近一次获得积分的联盟',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  allianceId?: number;

  @ApiPropertyOptional({
    example: 2,
    description:
      '当前所在商家（可选）。若该商家在本联盟是附属身份，则只能看到主体商家的券 —— 因为附属积分只能兑主体商品。',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  merchantId?: number;
}

/** 兑换记录查询 */
export class QueryExchangeRecordsDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '按用户过滤（H5 只传自己）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId?: number;

  @ApiPropertyOptional({ description: '按券模板过滤' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  templateId?: number;

  @ApiPropertyOptional({ description: '开始日期（含），yyyy-mm-dd' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: '结束日期（含），yyyy-mm-dd' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/** 积分规则编辑 */
export class UpdatePointRuleDto {
  @ApiPropertyOptional({ example: 1, description: '每消费 1 元获得积分' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  earnRatio?: number;

  @ApiPropertyOptional({ example: 1, description: '起送金额（元），低于该金额不送积分' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minAmount?: number;

  @ApiPropertyOptional({ example: 12, description: '积分有效期（月）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  pointsValidMonths?: number;

  @ApiPropertyOptional({ enum: ['FIXED_MONTHS', 'YEAR_END'], description: '过期模式' })
  @IsOptional()
  @IsIn(['FIXED_MONTHS', 'YEAR_END'])
  expireMode?: 'FIXED_MONTHS' | 'YEAR_END';

  @ApiPropertyOptional({ description: '1 生效 / 0 失效' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  status?: number;
}
