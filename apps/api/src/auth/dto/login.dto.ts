import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: '13458916040', description: '手机号（仅数字或与邮箱任一）或邮箱' })
  @IsString()
  @MinLength(3)
  account!: string;

  @ApiProperty({ example: '********' })
  @IsString()
  @MinLength(4)
  password!: string;
}
