import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SafeUser } from '../auth/auth.service';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { GetMessagesDto } from './dto/get-messages.dto';
import { DeleteMessageDto, DeleteScope } from './dto/delete-message.dto';

@ApiTags('Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly messagesGateway: MessagesGateway,
  ) {}

  // ─── Conversation list ────────────────────────────────────────────────────

  @Get('conversations')
  @ApiOperation({ summary: 'List all conversations with last message preview' })
  async getConversations(@CurrentUser() user: SafeUser) {
    const { id } = user;
    const result = await this.messagesService.getConversations(id);
    // Augment each conversation with real-time online status
    const data = (result!.data as any[]).map((conv) => ({
      ...conv,
      isOnline: this.messagesGateway.isUserOnline(conv.user?.id),
    }));
    return { message: result!.message, data };
  }

  // ─── Chat messages (paginated) ────────────────────────────────────────────

  @Get('chat/:userId')
  @ApiOperation({ summary: 'Get paginated messages with a user' })
  getMessages(
    @CurrentUser() user: SafeUser,
    @Param('userId', ParseIntPipe) otherUserId: number,
    @Query() query: GetMessagesDto,
  ) {
    const { id } = user;
    return this.messagesService.getMessages(id, otherUserId, query.cursor, query.limit);
  }

  // ─── Ice-breaker suggestions ──────────────────────────────────────────────

  @Get('suggestions')
  @ApiOperation({ summary: 'Get ice-breaker message suggestions for new connections' })
  getSuggestions() {
    return {
      message: 'Suggestions fetched',
      data: this.messagesService.getIceBreakerSuggestions(),
    };
  }

  // ─── Delete a message ─────────────────────────────────────────────────────

  @Delete(':messageId')
  @ApiOperation({ summary: 'Delete a message (for me or for everyone within 2h)' })
  async deleteMessage(
    @CurrentUser() user: SafeUser,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: DeleteMessageDto,
  ) {
    const { id } = user;
    const result = await this.messagesService.deleteMessage(id, messageId, dto.scope);

    // Broadcast real-time deletion to both participants
    if (dto.scope === DeleteScope.EVERYONE && result?.data) {
      const { senderId, receiverId } = result.data as {
        messageId: number;
        senderId: number;
        receiverId: number;
      };
      this.messagesGateway.broadcastMessageDeleted(senderId, receiverId, messageId);
    }

    return result;
  }

  // ─── Remove (hide) a conversation ─────────────────────────────────────────

  @Delete('conversation/:userId')
  @ApiOperation({ summary: 'Hide a conversation (only for the caller)' })
  hideConversation(
    @CurrentUser() user: SafeUser,
    @Param('userId', ParseIntPipe) otherUserId: number,
  ) {
    const { id } = user;
    return this.messagesService.hideConversation(id, otherUserId);
  }
}
