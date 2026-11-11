import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsPositive, IsString, Length } from 'class-validator';

/**
 * 「逛商家」商家页里的积分兑换。
 *
 * 会员端已经没有联盟概念：userId 取自令牌、扣分账户由进入的商家决定、
 * allianceId 由后端按券模板补上，所以请求体只需要券和幂等键。
 */
export class ExchangeAtShopDto {
  @ApiProperty({ example: 2001, description: '要兑换的券模板（必须出现在该商家的兑换区里）' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  templateId: number;

  @ApiProperty({ example: 'shopex-1731052800000-4821', description: '幂等键（8-64 字符），重复提交返回上次结果' })
  @IsString()
  @Length(8, 64)
  requestId: string;
}
