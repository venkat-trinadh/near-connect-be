import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InterestsDto {
  @ApiProperty({
    type: [String],
    minItems: 3,
    maxItems: 10,
    example: ['Coding', 'Running', 'Photography'],
  })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  interests!: string[];
}
