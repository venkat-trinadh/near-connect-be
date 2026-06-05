import { IsInt, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConnectionRequestDto {
  @ApiProperty({ description: 'ID of the user to send a connection request to', example: 42 })
  @IsInt()
  @IsPositive()
  targetUserId!: number;
}
