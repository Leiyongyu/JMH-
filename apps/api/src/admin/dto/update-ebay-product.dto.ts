import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateEbayProductDto {
  @IsOptional()
  @IsString()
  title?: string | null;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  price?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stockQty?: number;

  @IsOptional()
  @IsString()
  itemUrl?: string | null;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ENDED'])
  status?: string;

  @IsOptional()
  rawPayload?: Record<string, unknown> | null;
}

