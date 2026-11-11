import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, MinLength } from 'class-validator';

export class UpdatePasswordDto {
  @ApiProperty({ example: '123456', description: '原密码' })
  @IsString()
  @IsNotEmpty()
  oldPassword: string;

  @ApiProperty({ example: 'NewPass@2026', description: '新密码，至少 8 位' })
  @IsString()
  @MinLength(8, { message: '新密码至少 8 位' })
  @Length(8, 64)
  newPassword: string;
}
