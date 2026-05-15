import { IsInt, IsString, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @IsString()
  sku!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;
}

