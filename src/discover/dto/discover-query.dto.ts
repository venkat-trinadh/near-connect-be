import { Transform } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DiscoverQueryDto {
  @ApiPropertyOptional({ description: 'Latitude of the requesting user', example: 19.059 })
  @IsNumber()
  @Transform(({ value }) => parseFloat(value))
  lat!: number;

  @ApiPropertyOptional({ description: 'Longitude of the requesting user', example: 72.835 })
  @IsNumber()
  @Transform(({ value }) => parseFloat(value))
  lng!: number;

  @ApiPropertyOptional({ description: 'Search radius in km (minimum 1 km — no upper limit)', example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseFloat(value))
  radius?: number = 10;

  @ApiPropertyOptional({ description: 'Human-readable area name (reverse-geocoded on client)', example: 'Banjara Hills' })
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated user IDs already shown this session',
    example: '1,2,3',
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Transform(({ value }) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(Number);
    return String(value)
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
  })
  seen?: number[] = [];
}
