import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Length, Max, Min } from 'class-validator';

/** AI 协同：发分建议入参。金额上限与 EarnPointsDto 保持一致，避免预览能过、执行被拒。 */
export class EarnProposalDto {
  @ApiProperty({ example: 1001, description: '会员 userId（扫会员码后得到）' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId: number;

  @ApiProperty({ example: 168, description: '消费金额（元），由规则引擎折算积分' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999)
  amount: number;

  @ApiProperty({ example: 1, description: '发分联盟 id（前端取自商家所属联盟）' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  allianceId: number;

  @ApiPropertyOptional({ description: '门店 id，店员账号可省略（后端按 JWT 解析）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  storeId?: number;
}

/** AI 协同：确认执行。只接受服务端签发的票据，不接受前端直传积分。 */
export class EarnConfirmDto {
  @ApiProperty({ description: 'propose 返回的签名票据（10 分钟有效，不可篡改）' })
  @IsString()
  @Length(20, 2048)
  token: string;
}
