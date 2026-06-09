import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SafeUser } from '../auth/auth.service';
import { DiscoverService } from './discover.service';
import { DiscoverQueryDto } from './dto/discover-query.dto';

@ApiTags('Discover')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('discover')
export class DiscoverController {
  constructor(private readonly discover: DiscoverService) {}

  @Get('profile/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get public profile of a user by their ID' })
  async getUserProfile(
    @CurrentUser() user: object,
    @Param('userId', ParseIntPipe) targetUserId: number,
  ) {
    const { id } = user as SafeUser;
    return this.discover.getUserProfile(id, targetUserId);
  }

  @Get('count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Count nearby discoverable people within radius' })
  async getCount(@CurrentUser() user: object, @Query() query: DiscoverQueryDto) {
    const { id } = user as SafeUser;
    return this.discover.getCount(id, query);
  }

  @Get('next')
  @ApiOperation({
    summary: 'Get next person to show — returns 204 when everyone in radius has been seen',
  })
  async getNext(
    @CurrentUser() user: object,
    @Query() query: DiscoverQueryDto,
    @Res() res: Response,
  ) {
    const { id } = user as SafeUser;
    const result = await this.discover.getNext(id, query);

    if (!result) {
      return res.status(HttpStatus.NO_CONTENT).send();
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      message: result.message,
      data: result.data,
      timestamp: new Date().toISOString(),
    });
  }
}
