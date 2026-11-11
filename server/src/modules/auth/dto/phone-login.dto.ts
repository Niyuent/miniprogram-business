import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

/**
 * 手机号登录（短信验证码上线前的过渡方案）。
 *
 * 会员与商家共用同一个入口：后端先按手机号匹配后台账号（商家/店员），
 * 命中则签发后台令牌进商家端，否则按会员处理。
 *
 * TODO(短信验证码)：接入后必须在此处增加 `code` 字段，并在签发令牌前校验，
 * 否则任何人知道手机号就能登录他人账号。
 */
export class PhoneLoginDto {
  @ApiProperty({ description: '手机号（11 位）', example: '13900000001' })
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;
}
