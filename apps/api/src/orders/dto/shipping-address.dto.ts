import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ShippingAddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  recipientName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  countryRegion!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stateProvince!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  district?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  addressLine!: string;
}
