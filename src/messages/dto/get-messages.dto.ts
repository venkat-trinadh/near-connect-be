import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, Max, Min } from 'class-validator';

export class GetMessagesDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  cursor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit: number = 20;
}
