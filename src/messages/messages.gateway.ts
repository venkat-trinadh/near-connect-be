import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';

const chatRoom = (a: number, b: number) =>
  `chat:${Math.min(a, b)}:${Math.max(a, b)}`;

const userRoom = (id: number) => `user:${id}`;

@WebSocketGateway({
  namespace: '/messages',
  cors: {
    origin: (origin: string, cb: (err: Error | null, allow: boolean) => void) => {
      cb(null, true); // CORS is enforced at HTTP layer; allow all WS origins
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class MessagesGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  // userId → Set<socketId> — in-memory online presence tracker
  private readonly onlineUsers = new Map<number, Set<string>>();

  constructor(
    private readonly messagesService: MessagesService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Connection & Auth ────────────────────────────────────────────────────

  async handleConnection(socket: Socket) {
    const token =
      (socket.handshake.auth as Record<string, string>)?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      socket.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify<{ sub: number }>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });

      socket.data.userId = payload.sub;

      // Join personal room
      await socket.join(userRoom(payload.sub));

      // Track online presence
      if (!this.onlineUsers.has(payload.sub)) {
        this.onlineUsers.set(payload.sub, new Set());
      }
      this.onlineUsers.get(payload.sub)!.add(socket.id);

      // Update lastSeenAt
      await this.prisma.user.update({
        where: { id: payload.sub },
        data: { lastSeenAt: new Date() },
      });

      // Deliver SENT messages that arrived while offline
      await this.deliverPendingMessages(payload.sub);

      // Broadcast online status to active chat rooms this user is in
      this.broadcastPresence(payload.sub, true);
    } catch {
      socket.disconnect();
    }
  }

  async handleDisconnect(socket: Socket) {
    const userId: number | undefined = socket.data.userId;
    if (!userId) return;

    const sockets = this.onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);

      if (sockets.size === 0) {
        this.onlineUsers.delete(userId);
        const lastSeenAt = new Date();

        await this.prisma.user.update({
          where: { id: userId },
          data: { lastSeenAt },
        });

        this.broadcastPresence(userId, false, lastSeenAt);
      }
    }
  }

  // ─── Join / leave a chat room ─────────────────────────────────────────────

  @SubscribeMessage('join_chat')
  async handleJoinChat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { otherUserId: number },
  ) {
    const userId: number = socket.data.userId;
    const room = chatRoom(userId, data.otherUserId);
    await socket.join(room);

    // Tell the client if the other user is online
    const isOnline = this.onlineUsers.has(data.otherUserId);
    const otherUser = await this.prisma.user.findUnique({
      where: { id: data.otherUserId },
      select: { lastSeenAt: true },
    });

    socket.emit('online_status', {
      userId: data.otherUserId,
      isOnline,
      lastSeenAt: isOnline ? null : otherUser?.lastSeenAt ?? null,
    });
  }

  @SubscribeMessage('leave_chat')
  async handleLeaveChat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { otherUserId: number },
  ) {
    const userId: number = socket.data.userId;
    await socket.leave(chatRoom(userId, data.otherUserId));
  }

  // ─── Send message ─────────────────────────────────────────────────────────

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { receiverId: number; content: string },
  ) {
    const senderId: number = socket.data.userId;

    const message = await this.messagesService
      .saveMessage(senderId, data.receiverId, data.content)
      .catch((err: Error) => {
        socket.emit('error', { event: 'send_message', message: err.message });
        return null;
      });

    if (!message) return;

    const room = chatRoom(senderId, data.receiverId);

    // Emit to chat room (covers both users if both joined)
    this.server.to(room).emit('new_message', message);

    // Also emit to receiver's personal room (covers the case where receiver
    // hasn't joined this specific chat room yet — e.g. on the conversation list)
    this.server.to(userRoom(data.receiverId)).emit('new_message', message);

    // If receiver is online → mark as delivered
    if (this.onlineUsers.has(data.receiverId)) {
      const delivered = await this.messagesService
        .markDelivered(message.id)
        .catch(() => null);

      if (delivered) {
        // Notify sender of the status update
        this.server.to(userRoom(senderId)).emit('message_status_updated', {
          messageId: delivered.id,
          status: 'DELIVERED',
        });
      }
    }

    // Ack back to sender with saved message
    return message;
  }

  // ─── Typing indicators ────────────────────────────────────────────────────

  @SubscribeMessage('typing_start')
  handleTypingStart(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { receiverId: number },
  ) {
    const senderId: number = socket.data.userId;
    this.server
      .to(userRoom(data.receiverId))
      .emit('typing', { userId: senderId });
  }

  @SubscribeMessage('typing_stop')
  handleTypingStop(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { receiverId: number },
  ) {
    const senderId: number = socket.data.userId;
    this.server
      .to(userRoom(data.receiverId))
      .emit('stop_typing', { userId: senderId });
  }

  // ─── Mark messages as read ────────────────────────────────────────────────

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { otherUserId: number },
  ) {
    const userId: number = socket.data.userId;
    const count = await this.messagesService.markMessagesRead(
      data.otherUserId,
      userId,
    );

    if (count > 0) {
      // Notify the original sender that their messages were read
      this.server.to(userRoom(data.otherUserId)).emit('messages_read', {
        byUserId: userId,
        count,
      });
    }

    return { count };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private broadcastPresence(userId: number, isOnline: boolean, lastSeenAt?: Date) {
    // Emit to all rooms this user is in — covers all chat partners currently in
    // the same room, plus the user's own personal room
    const payload = {
      userId,
      isOnline,
      lastSeenAt: isOnline ? null : (lastSeenAt ?? null),
    };

    // Emit to every chat room pattern `chat:X:Y` that includes this userId
    // We use the server broadcast and let clients filter by userId
    this.server.emit('online_status', payload);
  }

  private async deliverPendingMessages(receiverId: number) {
    const pending = await this.messagesService.getPendingMessages(receiverId);

    await Promise.all(
      pending.map(async (msg) => {
        const delivered = await this.messagesService
          .markDelivered(msg.id)
          .catch(() => null);

        if (delivered) {
          this.server.to(userRoom(msg.senderId)).emit('message_status_updated', {
            messageId: msg.id,
            status: 'DELIVERED',
          });
        }
      }),
    );
  }

  // ─── Public helpers used by MessagesController ───────────────────────────

  isUserOnline(userId: number): boolean {
    return this.onlineUsers.has(userId);
  }

  broadcastMessageDeleted(senderId: number, receiverId: number, messageId: number) {
    const payload = { messageId };
    // Emit to the shared chat room (covers both users if they have it open)
    this.server.to(chatRoom(senderId, receiverId)).emit('message_deleted', payload);
    // Also emit to each user's personal room (covers the conversation list view)
    this.server.to(userRoom(senderId)).emit('message_deleted', payload);
    this.server.to(userRoom(receiverId)).emit('message_deleted', payload);
  }
}
