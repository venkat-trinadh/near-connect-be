import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { catchBlock } from '../common/util/CatchBlock';
import { DeleteScope } from './dto/delete-message.dto';

const DELETE_FOR_EVERYONE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

// How the content field looks for deleted messages
export const DELETED_FOR_ME_PLACEHOLDER = null;
export const DELETED_FOR_EVERYONE_PLACEHOLDER = '__deleted_for_everyone__';

export type ChatStatus = 'ACTIVE' | 'REMOVED' | 'BLOCKED';

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Conversation list ────────────────────────────────────────────────────

  async getConversations(userId: number) {
    try {
      // Get all users this user has exchanged at least one message with
      const hidden = await this.prisma.hiddenConversation.findMany({
        where: { userId },
        select: { otherUserId: true },
      });
      const hiddenIds = new Set(hidden.map((h) => h.otherUserId));

      // Distinct partner IDs from messages
      const [asSender, asReceiver] = await Promise.all([
        this.prisma.message.findMany({
          where: { senderId: userId, isDeletedBySender: false },
          select: { receiverId: true },
          distinct: ['receiverId'],
        }),
        this.prisma.message.findMany({
          where: { receiverId: userId, isDeletedByReceiver: false },
          select: { senderId: true },
          distinct: ['senderId'],
        }),
      ]);

      const partnerIds = new Set([
        ...asSender.map((m) => m.receiverId),
        ...asReceiver.map((m) => m.senderId),
      ]);

      // Remove hidden conversations
      for (const id of hiddenIds) partnerIds.delete(id);

      if (partnerIds.size === 0) {
        return { message: 'Conversations fetched', data: [] };
      }

      // Fetch latest message + unread count per partner
      const conversations = await Promise.all(
        [...partnerIds].map((partnerId) =>
          this.buildConversationEntry(userId, partnerId),
        ),
      );

      // Sort by latest message descending
      conversations.sort(
        (a, b) =>
          new Date(b.lastMessage!.createdAt).getTime() -
          new Date(a.lastMessage!.createdAt).getTime(),
      );

      return { message: 'Conversations fetched', data: conversations };
    } catch (error) {
      catchBlock(error);
    }
  }

  private async buildConversationEntry(userId: number, partnerId: number) {
    const [lastMessage, unreadCount, partner] = await Promise.all([
      this.prisma.message.findFirst({
        where: {
          OR: [
            { senderId: userId, receiverId: partnerId, isDeletedBySender: false },
            { senderId: partnerId, receiverId: userId, isDeletedByReceiver: false },
          ],
          deletedForEveryone: false,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          senderId: true,
          content: true,
          status: true,
          createdAt: true,
          deletedForEveryone: true,
        },
      }),
      this.prisma.message.count({
        where: {
          senderId: partnerId,
          receiverId: userId,
          isDeletedByReceiver: false,
          deletedForEveryone: false,
          status: { not: 'READ' },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: partnerId },
        select: {
          id: true,
          displayName: true,
          avatarId: true,
          username: true,
          lastSeenAt: true,
        },
      }),
    ]);

    return {
      user: partner,
      lastMessage,
      unreadCount,
    };
  }

  // ─── Chat messages (cursor-based pagination) ──────────────────────────────

  async getMessages(
    userId: number,
    otherUserId: number,
    cursor?: number,
    limit = 20,
  ) {
    try {
      const other = await this.prisma.user.findUnique({
        where: { id: otherUserId },
        select: {
          id: true,
          displayName: true,
          avatarId: true,
          username: true,
          lastSeenAt: true,
        },
      });
      if (!other) throw new NotFoundException('User not found');

      const chatStatus = await this.getChatStatus(userId, otherUserId);

      const messages = await this.prisma.message.findMany({
        where: {
          OR: [
            { senderId: userId, receiverId: otherUserId, isDeletedBySender: false },
            { senderId: otherUserId, receiverId: userId, isDeletedByReceiver: false },
          ],
          ...(cursor ? { id: { lt: cursor } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        select: {
          id: true,
          senderId: true,
          receiverId: true,
          content: true,
          status: true,
          deletedForEveryone: true,
          readAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const hasMore = messages.length > limit;
      if (hasMore) messages.pop();

      // Sanitize deleted-for-everyone content
      const sanitized = messages.map((m) => ({
        ...m,
        content: m.deletedForEveryone ? null : m.content,
      }));

      return {
        message: 'Messages fetched',
        data: {
          messages: sanitized,
          nextCursor: hasMore ? messages[messages.length - 1]?.id : null,
          chatStatus,
          otherUser: other,
        },
      };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Chat status ──────────────────────────────────────────────────────────

  async getChatStatus(userId: number, otherUserId: number): Promise<ChatStatus> {
    const [block, connection] = await Promise.all([
      this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: otherUserId },
            { blockerId: otherUserId, blockedId: userId },
          ],
        },
      }),
      this.prisma.connectionRequest.findFirst({
        where: {
          OR: [
            { senderId: userId, receiverId: otherUserId, status: 'ACCEPTED' },
            { senderId: otherUserId, receiverId: userId, status: 'ACCEPTED' },
          ],
        },
      }),
    ]);

    if (block) return 'BLOCKED';
    if (connection) return 'ACTIVE';
    return 'REMOVED';
  }

  // ─── Save a new message ───────────────────────────────────────────────────

  async saveMessage(senderId: number, receiverId: number, content: string) {
    try {
      // Validate connection
      const chatStatus = await this.getChatStatus(senderId, receiverId);
      if (chatStatus !== 'ACTIVE') {
        throw new BadRequestException(
          chatStatus === 'BLOCKED'
            ? 'This chat is unavailable'
            : 'You are not connected with this user',
        );
      }

      const message = await this.prisma.message.create({
        data: { senderId, receiverId, content },
        select: {
          id: true,
          senderId: true,
          receiverId: true,
          content: true,
          status: true,
          deletedForEveryone: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Un-hide conversation for both sides on new message
      await this.prisma.hiddenConversation.deleteMany({
        where: {
          OR: [
            { userId: senderId, otherUserId: receiverId },
            { userId: receiverId, otherUserId: senderId },
          ],
        },
      });

      return message;
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Mark message as delivered ────────────────────────────────────────────

  async markDelivered(messageId: number) {
    return this.prisma.message.update({
      where: { id: messageId, status: 'SENT' },
      data: { status: 'DELIVERED' },
      select: { id: true, senderId: true, receiverId: true, status: true },
    });
  }

  // ─── Mark all unread messages as read ────────────────────────────────────

  async markMessagesRead(fromUserId: number, toUserId: number) {
    const now = new Date();
    const updated = await this.prisma.message.updateMany({
      where: {
        senderId: fromUserId,
        receiverId: toUserId,
        status: { not: 'READ' },
        isDeletedByReceiver: false,
      },
      data: { status: 'READ', readAt: now },
    });
    return updated.count;
  }

  // ─── Get unread messages to deliver on reconnect ─────────────────────────

  async getPendingMessages(receiverId: number) {
    return this.prisma.message.findMany({
      where: {
        receiverId,
        status: 'SENT',
        isDeletedByReceiver: false,
        deletedForEveryone: false,
      },
      select: { id: true, senderId: true },
    });
  }

  // ─── Delete message ───────────────────────────────────────────────────────

  async deleteMessage(userId: number, messageId: number, scope: DeleteScope) {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          senderId: true,
          receiverId: true,
          createdAt: true,
          deletedForEveryone: true,
        },
      });

      if (!message) throw new NotFoundException('Message not found');

      const isParticipant =
        message.senderId === userId || message.receiverId === userId;
      if (!isParticipant) throw new ForbiddenException('Access denied');

      if (message.deletedForEveryone) {
        throw new BadRequestException('Message already deleted for everyone');
      }

      if (scope === DeleteScope.EVERYONE) {
        if (message.senderId !== userId) {
          throw new ForbiddenException('Only the sender can delete for everyone');
        }
        const age = Date.now() - new Date(message.createdAt).getTime();
        if (age > DELETE_FOR_EVERYONE_LIMIT_MS) {
          throw new BadRequestException(
            'Messages can only be deleted for everyone within 2 hours of sending',
          );
        }
        await this.prisma.message.update({
          where: { id: messageId },
          data: { deletedForEveryone: true, content: DELETED_FOR_EVERYONE_PLACEHOLDER },
        });
        return {
          message: 'Message deleted for everyone',
          data: { messageId, senderId: message.senderId, receiverId: message.receiverId },
        };
      }

      // Delete for ME only
      const isSender = message.senderId === userId;
      await this.prisma.message.update({
        where: { id: messageId },
        data: isSender ? { isDeletedBySender: true } : { isDeletedByReceiver: true },
      });

      return { message: 'Message deleted', data: { messageId } };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Hide conversation ────────────────────────────────────────────────────

  async hideConversation(userId: number, otherUserId: number) {
    try {
      const other = await this.prisma.user.findUnique({
        where: { id: otherUserId },
        select: { id: true },
      });
      if (!other) throw new NotFoundException('User not found');

      await this.prisma.hiddenConversation.upsert({
        where: { userId_otherUserId: { userId, otherUserId } },
        create: { userId, otherUserId },
        update: { hiddenAt: new Date() },
      });

      return { message: 'Conversation removed', data: { otherUserId } };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Ice-breaker suggestions ──────────────────────────────────────────────

  getIceBreakerSuggestions(): string[] {
    return [
      "Hey! What's something you're passionate about?",
      "What's the best place you've discovered near you?",
      "If you could do anything this weekend, what would it be?",
    ];
  }
}
