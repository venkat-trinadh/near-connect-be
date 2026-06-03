import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum GenderDto {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  PREFER_NOT_TO_SAY = 'PREFER_NOT_TO_SAY',
}

export class BasicInfoDto {
  @ApiProperty({ example: 'Venkata Trinadh', maxLength: 40 })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  displayName!: string;

  @ApiPropertyOptional({ example: 'Building products people love.', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  bio?: string;

  @ApiProperty({ enum: GenderDto })
  @IsEnum(GenderDto)
  gender!: GenderDto;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  genderVisible?: boolean;
}
