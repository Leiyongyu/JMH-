import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { UserRole } from '../../users/user.entity';

export class CreateUserDto {
  @IsString()
  @MaxLength(191)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password!: string;

  @IsIn(['ADMIN', 'DISTRIBUTOR'] satisfies UserRole[])
  role!: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  displayName?: string;
}
