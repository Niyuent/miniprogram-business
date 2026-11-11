import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, Length, Matches } from 'class-validator';
import { PageQueryDto } from './merchant.dto';

/** 附属商家提交入驻申请（公开接口，无需登录） */
export class CreateApplicationDto {
  @ApiProperty({ example: '城北便利店' })
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({ example: '陈城北' })
  @IsString()
  @Length(2, 50)
  contactName: string;

  @ApiProperty({ example: '13900000009' })
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '联系人手机号格式不正确' })
  contactPhone: string;

  @ApiProperty({ example: '91310000MA1FL0009X', description: '营业执照号，必填' })
  @IsString()
  @Length(5, 64)
  licenseNo: string;

  @ApiPropertyOptional({ example: '上海市' })
  @IsOptional()
  @IsString()
  @Length(2, 32)
  province?: string;

  @ApiPropertyOptional({ example: '上海市' })
  @IsOptional()
  @IsString()
  @Length(2, 32)
  city?: string;

  @ApiPropertyOptional({ example: '杨浦区' })
  @IsOptional()
  @IsString()
  @Length(2, 32)
  district?: string;

  @ApiPropertyOptional({ example: '控江路 800 号' })
  @IsOptional()
  @IsString()
  @Length(2, 255)
  address?: string;

  @ApiPropertyOptional({
    description: '营业执照图片地址数组，来自 POST /upload',
    example: ['/uploads/2026/10/xxxx.jpg'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  licenseImages?: string[];

  @ApiPropertyOptional({ description: '线下结算联系人（仅记录，系统不参与资金结算）' })
  @IsOptional()
  @IsString()
  @Length(2, 255)
  settleContact?: string;

  @ApiPropertyOptional({
    description: '邀请码（主体商家分享带上的 SM{merchantId}）；无效码忽略，仅作入驻归因',
    example: 'SM45',
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  inviteCode?: string;
}

export class QueryApplicationsDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'],
    description: '默认 PENDING（待审核）',
  })
  @IsOptional()
  @IsString()
  status?: string;
}

export class ApproveApplicationDto {
  @ApiPropertyOptional({ description: '审核备注' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  auditRemark?: string;

  @ApiPropertyOptional({
    description: '是否自动为附属商家创建管理员账号，默认 true',
    default: true,
  })
  @IsOptional()
  createAccount?: boolean;
}

export class RejectApplicationDto {
  @ApiProperty({ description: '驳回原因，必填' })
  @IsString()
  @Length(2, 255)
  auditRemark: string;
}
