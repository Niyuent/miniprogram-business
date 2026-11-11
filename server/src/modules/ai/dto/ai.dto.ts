import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class RunDailyReportDto {
  @ApiPropertyOptional({ description: '只给这一家出日报；不传则全部已审核商家' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  merchantId?: number;
}

export class RecentScanDto {
  @ApiProperty({ description: '候选用户 id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;

  @ApiProperty({ description: '候选用户姓名，作为 Laya choice 的选项' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @ApiProperty({ description: '距现在多少分钟前扫过码，越小越近' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minutesAgo!: number;
}

export class AnalyzeAbnormalDto {
  @ApiProperty({ description: '异常订单 id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderId!: number;
}

export class RecognizeLicenseDto {
  @ApiProperty({ description: '入驻申请对应的商家 id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  merchantId!: number;
}

export class IdentifyUserDto {
  @ApiProperty({ example: '刚才那个客人消费58' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  voiceText!: string;

  @ApiProperty({ type: [RecentScanDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RecentScanDto)
  recentScans!: RecentScanDto[];
}
