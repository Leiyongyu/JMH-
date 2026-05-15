import { IsInt, Max, Min } from 'class-validator';

export class SetCartItemQtyDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;
}

