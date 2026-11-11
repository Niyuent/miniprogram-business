import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/** C 端登录：微信 wx.login 拿到的 code */
export class UserLoginDto {
  @ApiProperty({ description: '微信 wx.login 返回的 code', example: 'dev-code-1001' })
  @IsString()
  @Length(1, 128)
  code!: string;

  @ApiPropertyOptional({
    description: '邀请码（会员分享带上的 U{userId}）；仅新用户首触记录，无效码忽略',
    example: 'U1024',
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  inviterCode?: string;
}
