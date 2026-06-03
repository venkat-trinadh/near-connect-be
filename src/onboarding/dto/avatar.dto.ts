import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AvatarDto {
  @ApiProperty({ example: 'male_01', description: 'Avatar identifier e.g. male_01 or female_07' })
  @IsString()
  @Matches(/^(male|female)_\d{2}$|^default$/, {
    message: 'avatarId must be in format "male_01", "female_07", or "default"',
  })
  avatarId!: string;
}
