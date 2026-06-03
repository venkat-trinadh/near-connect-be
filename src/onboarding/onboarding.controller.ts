import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SafeUser } from '../auth/auth.service';
import { BasicInfoDto } from './dto/basic-info.dto';
import { AvatarDto } from './dto/avatar.dto';
import { InterestsDto } from './dto/interests.dto';
import { LocationDto } from './dto/location.dto';
import { UsernameDto } from './dto/username.dto';

@ApiTags('Onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get current onboarding status and saved profile data' })
  async getStatus(@CurrentUser() user: object) {
    const { id } = user as SafeUser;
    return this.onboarding.getStatus(id);
  }

  @Patch('basic-info')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 2 — Save display name, bio, and gender' })
  async saveBasicInfo(@CurrentUser() user: object, @Body() dto: BasicInfoDto) {
    const { id } = user as SafeUser;
    return this.onboarding.saveBasicInfo(id, dto);
  }

  @Patch('avatar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 3 — Save selected avatar ID' })
  async saveAvatar(@CurrentUser() user: object, @Body() dto: AvatarDto) {
    const { id } = user as SafeUser;
    return this.onboarding.saveAvatar(id, dto);
  }

  @Patch('interests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 4 — Save selected interests (min 3, max 10)' })
  async saveInterests(@CurrentUser() user: object, @Body() dto: InterestsDto) {
    const { id } = user as SafeUser;
    return this.onboarding.saveInterests(id, dto);
  }

  @Patch('location')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 5 — Save location permission result and coordinates' })
  async saveLocation(@CurrentUser() user: object, @Body() dto: LocationDto) {
    const { id } = user as SafeUser;
    return this.onboarding.saveLocation(id, dto);
  }

  @Get('username/check/:handle')
  @ApiOperation({ summary: 'Step 6 — Check if a username handle is available' })
  async checkUsername(@Param('handle') handle: string) {
    return this.onboarding.checkUsername(handle);
  }

  @Patch('username')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 6 — Save chosen username' })
  async saveUsername(@CurrentUser() user: object, @Body() dto: UsernameDto) {
    const { id } = user as SafeUser;
    return this.onboarding.saveUsername(id, dto);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 7 — Mark onboarding as complete' })
  async complete(@CurrentUser() user: object) {
    const { id } = user as SafeUser;
    return this.onboarding.completeOnboarding(id);
  }
}
