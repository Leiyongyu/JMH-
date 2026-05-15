import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { UserRole } from '../../users/user.entity';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'DISTRIBUTOR'] satisfies UserRole[])
  role?: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  displayName?: string;
}
