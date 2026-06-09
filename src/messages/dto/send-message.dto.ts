import { IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsInt()
  @IsPositive()
  receiverId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}
