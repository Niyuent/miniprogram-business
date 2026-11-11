import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin', description: '后台账号' })
  @IsString()
  @IsNotEmpty({ message: '账号不能为空' })
  @Length(2, 50)
  username: string;

  @ApiProperty({ example: '123456', description: '密码' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @Length(6, 64)
  password: string;
}
