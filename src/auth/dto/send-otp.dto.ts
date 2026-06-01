import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ example: '+1', description: 'Country code including + prefix' })
  @IsString()
  @Matches(/^\+\d{1,4}$/, { message: 'Country code must be in format +1, +44, etc.' })
  countryCode!: string;

  @ApiProperty({ example: '5550001234', description: 'Phone number without country code' })
  @IsString()
  @Matches(/^\d{7,15}$/, { message: 'Phone number must be 7–15 digits' })
  phoneNumber!: string;
}
