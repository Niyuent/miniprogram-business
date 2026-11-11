import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** 会员端 ↔ 商家端切换：按当前账号手机号在 users / admin_users 两侧对齐 */
export class SwitchModeDto {
  @ApiProperty({ enum: ['member', 'merchant'], description: '目标身份' })
  @IsIn(['member', 'merchant'])
  mode!: 'member' | 'merchant';
}
