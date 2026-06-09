import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { catchBlock } from '../common/util/CatchBlock';
import type { ConnectionRequestDto } from './dto/connection-request.dto';

@Injectable()
export class ConnectionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Send request ─────────────────────────────────────────────────────────

  async sendRequest(senderId: number, dto: ConnectionRequestDto) {
    try {
      const { targetUserId } = dto;

      if (senderId === targetUserId) {
        throw new BadRequestException('You cannot connect with yourself');
      }

      const target = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('User not found');

      // check for block in either direction
      const block = await this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: senderId, blockedId: targetUserId },
            { blockerId: targetUserId, blockedId: senderId },
          ],
        },
      });
      if (block) throw new BadRequestException('Unable to send connection request');

      // check for existing request in either direction
      const existing = await this.prisma.connectionRequest.findFirst({
        where: {
          OR: [
            { senderId, receiverId: targetUserId },
            { senderId: targetUserId, receiverId: senderId },
          ],
        },
      });

      if (existing) {
        if (existing.status === 'ACCEPTED') {
          throw new ConflictException('You are already connected with this user');
        }
        if (existing.status === 'PENDING') {
          throw new ConflictException('A connection request already exists');
        }
        // REJECTED — allow re-request by updating
        const updated = await this.prisma.connectionRequest.update({
          where: { id: existing.id },
          data: { senderId, receiverId: targetUserId, status: 'PENDING' },
          select: { id: true, status: true },
        });
        return {
          message: 'Connection request sent',
          data: { requestId: updated.id, status: updated.status.toLowerCase() },
        };
      }

      const request = await this.prisma.connectionRequest.create({
        data: { senderId, receiverId: targetUserId },
        select: { id: true, status: true },
      });

      return {
        message: 'Connection request sent',
        data: { requestId: request.id, status: request.status.toLowerCase() },
      };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── List my connections ──────────────────────────────────────────────────

  async listConnections(userId: number) {
    try {
      const requests = await this.prisma.connectionRequest.findMany({
        where: {
          OR: [{ senderId: userId }, { receiverId: userId }],
          status: 'ACCEPTED',
        },
        select: {
          id: true,
          senderId: true,
          createdAt: true,
          sender: {
            select: { id: true, displayName: true, username: true, avatarId: true, locationArea: true },
          },
          receiver: {
            select: { id: true, displayName: true, username: true, avatarId: true, locationArea: true },
          },
        },
      });

      const connections = requests.map((r) => ({
        requestId: r.id,
        connectedAt: r.createdAt,
        user: r.senderId === userId ? r.receiver : r.sender,
      }));

      return { message: 'Connections fetched', data: connections };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── List sent pending requests ───────────────────────────────────────────

  async listSent(userId: number) {
    try {
      const requests = await this.prisma.connectionRequest.findMany({
        where: { senderId: userId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          receiver: {
            select: { id: true, displayName: true, username: true, avatarId: true, locationArea: true },
          },
        },
      });

      return {
        message: 'Sent requests fetched',
        data: requests.map((r) => ({
          requestId: r.id,
          status: r.status.toLowerCase(),
          sentAt: r.createdAt,
          to: r.receiver,
        })),
      };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── List incoming pending requests ───────────────────────────────────────

  async listIncoming(userId: number) {
    try {
      const requests = await this.prisma.connectionRequest.findMany({
        where: { receiverId: userId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          sender: {
            select: { id: true, displayName: true, username: true, avatarId: true, locationArea: true },
          },
        },
      });

      return {
        message: 'Incoming requests fetched',
        data: requests.map((r) => ({
          requestId: r.id,
          sentAt: r.createdAt,
          from: r.sender,
        })),
      };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Cancel a sent request ────────────────────────────────────────────────

  async cancelSentRequest(senderId: number, requestId: number) {
    try {
      const request = await this.prisma.connectionRequest.findUnique({
        where: { id: requestId },
        select: { id: true, senderId: true, status: true },
      });

      if (!request) throw new NotFoundException('Connection request not found');
      if (request.senderId !== senderId) throw new BadRequestException('Not your request to cancel');
      if (request.status !== 'PENDING') throw new BadRequestException('Request is no longer pending');

      await this.prisma.connectionRequest.delete({ where: { id: requestId } });

      return { message: 'Connection request cancelled', data: { requestId } };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Remove an accepted connection ────────────────────────────────────────

  async removeConnection(userId: number, requestId: number) {
    try {
      const request = await this.prisma.connectionRequest.findUnique({
        where: { id: requestId },
        select: { id: true, senderId: true, receiverId: true, status: true },
      });

      if (!request) throw new NotFoundException('Connection not found');
      if (request.status !== 'ACCEPTED') throw new BadRequestException('No accepted connection found');
      if (request.senderId !== userId && request.receiverId !== userId) {
        throw new BadRequestException('Not your connection to remove');
      }

      await this.prisma.connectionRequest.delete({ where: { id: requestId } });

      return { message: 'Connection removed', data: { requestId } };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Respond to a request ─────────────────────────────────────────────────

  async respondToRequest(userId: number, requestId: number, accept: boolean) {
    try {
      const request = await this.prisma.connectionRequest.findUnique({
        where: { id: requestId },
        select: { id: true, receiverId: true, status: true },
      });

      if (!request) throw new NotFoundException('Connection request not found');
      if (request.receiverId !== userId) throw new BadRequestException('Not your request to respond to');
      if (request.status !== 'PENDING') throw new BadRequestException('Request is no longer pending');

      const updated = await this.prisma.connectionRequest.update({
        where: { id: requestId },
        data: { status: accept ? 'ACCEPTED' : 'REJECTED' },
        select: { id: true, status: true },
      });

      return {
        message: accept ? 'Connection accepted' : 'Connection declined',
        data: { requestId: updated.id, status: updated.status.toLowerCase() },
      };
    } catch (error) {
      catchBlock(error);
    }
  }
}
