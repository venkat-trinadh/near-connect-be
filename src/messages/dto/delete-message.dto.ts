import { IsEnum } from 'class-validator';

export enum DeleteScope {
  ME = 'ME',
  EVERYONE = 'EVERYONE',
}

export class DeleteMessageDto {
  @IsEnum(DeleteScope)
  scope: DeleteScope;
}
