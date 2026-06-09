import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SafeUser } from '../auth/auth.service';
import { ConnectionsService } from './connections.service';
import { ConnectionRequestDto } from './dto/connection-request.dto';

@ApiTags('Connections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a connection request to another user' })
  async sendRequest(@CurrentUser() user: object, @Body() dto: ConnectionRequestDto) {
    const { id } = user as SafeUser;
    return this.connections.sendRequest(id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all accepted connections for the current user' })
  async listConnections(@CurrentUser() user: object) {
    const { id } = user as SafeUser;
    return this.connections.listConnections(id);
  }

  @Get('requests/sent')
  @ApiOperation({ summary: 'List pending sent connection requests — for "View My Requests" screen' })
  async listSent(@CurrentUser() user: object) {
    const { id } = user as SafeUser;
    return this.connections.listSent(id);
  }

  @Get('requests/incoming')
  @ApiOperation({ summary: 'List pending incoming connection requests' })
  async listIncoming(@CurrentUser() user: object) {
    const { id } = user as SafeUser;
    return this.connections.listIncoming(id);
  }

  @Patch('requests/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a pending connection request' })
  async accept(@CurrentUser() user: object, @Param('id', ParseIntPipe) requestId: number) {
    const { id } = user as SafeUser;
    return this.connections.respondToRequest(id, requestId, true);
  }

  @Patch('requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a pending connection request' })
  async reject(@CurrentUser() user: object, @Param('id', ParseIntPipe) requestId: number) {
    const { id } = user as SafeUser;
    return this.connections.respondToRequest(id, requestId, false);
  }

  @Delete('requests/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending sent connection request' })
  async cancelSent(@CurrentUser() user: object, @Param('id', ParseIntPipe) requestId: number) {
    const { id } = user as SafeUser;
    return this.connections.cancelSentRequest(id, requestId);
  }

  @Delete(':requestId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an accepted connection' })
  async removeConnection(@CurrentUser() user: object, @Param('requestId', ParseIntPipe) requestId: number) {
    const { id } = user as SafeUser;
    return this.connections.removeConnection(id, requestId);
  }
}
