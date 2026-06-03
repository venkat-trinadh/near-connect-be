import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { catchBlock } from '../common/util/CatchBlock';
import type { BasicInfoDto } from './dto/basic-info.dto';
import type { AvatarDto } from './dto/avatar.dto';
import type { InterestsDto } from './dto/interests.dto';
import type { LocationDto } from './dto/location.dto';
import type { UsernameDto } from './dto/username.dto';

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Status ───────────────────────────────────────────────────────────────

  async getStatus(userId: number) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          isOnboardingComplete: true,
          onboardingStep: true,
          displayName: true,
          bio: true,
          gender: true,
          genderVisible: true,
          avatarId: true,
          interests: true,
          locationGranted: true,
          locationArea: true,
          username: true,
        },
      });

      if (!user) throw new NotFoundException('User not found');

      return { message: 'Onboarding status fetched', data: user };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Step 2: Basic Info ───────────────────────────────────────────────────

  async saveBasicInfo(userId: number, dto: BasicInfoDto) {
    try {
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { onboardingStep: true },
      });

      if (!current) throw new NotFoundException('User not found');

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          displayName: dto.displayName.trim(),
          bio: dto.bio?.trim() ?? null,
          gender: dto.gender as any,
          genderVisible: dto.genderVisible ?? true,
          onboardingStep: Math.max(2, current.onboardingStep),
        },
      });

      return { message: 'Basic info saved', data: null };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Step 3: Avatar ───────────────────────────────────────────────────────

  async saveAvatar(userId: number, dto: AvatarDto) {
    try {
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { onboardingStep: true },
      });

      if (!current) throw new NotFoundException('User not found');

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          avatarId: dto.avatarId,
          onboardingStep: Math.max(3, current.onboardingStep),
        },
      });

      return { message: 'Avatar saved', data: null };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Step 4: Interests ────────────────────────────────────────────────────

  async saveInterests(userId: number, dto: InterestsDto) {
    try {
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { onboardingStep: true },
      });

      if (!current) throw new NotFoundException('User not found');

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          interests: dto.interests,
          onboardingStep: Math.max(4, current.onboardingStep),
        },
      });

      return { message: 'Interests saved', data: null };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Step 5: Location ─────────────────────────────────────────────────────

  async saveLocation(userId: number, dto: LocationDto) {
    try {
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { onboardingStep: true },
      });

      if (!current) throw new NotFoundException('User not found');

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          locationGranted: dto.locationGranted,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          locationArea: dto.locationArea ?? null,
          onboardingStep: Math.max(5, current.onboardingStep),
        },
      });

      return { message: 'Location saved', data: null };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Step 6: Username check ───────────────────────────────────────────────

  async checkUsername(handle: string) {
    try {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) {
        throw new BadRequestException(
          'Username must be 3–20 characters and contain only letters, numbers, and underscores',
        );
      }

      const existing = await this.prisma.user.findUnique({
        where: { username: handle.toLowerCase() },
        select: { id: true },
      });

      const available = !existing;
      return {
        message: available ? 'Username is available' : 'Username is already taken',
        data: { available },
      };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Step 6: Username save ────────────────────────────────────────────────

  async saveUsername(userId: number, dto: UsernameDto) {
    try {
      const handle = dto.username.toLowerCase();

      const conflict = await this.prisma.user.findFirst({
        where: { username: handle, NOT: { id: userId } },
        select: { id: true },
      });

      if (conflict) throw new ConflictException('This username is already taken');

      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { onboardingStep: true },
      });

      if (!current) throw new NotFoundException('User not found');

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          username: handle,
          onboardingStep: Math.max(6, current.onboardingStep),
        },
      });

      return { message: 'Username saved', data: { username: handle } };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Step 7: Complete ─────────────────────────────────────────────────────

  async completeOnboarding(userId: number) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          displayName: true,
          gender: true,
          interests: true,
          username: true,
        },
      });

      if (!user) throw new NotFoundException('User not found');

      if (!user.displayName)
        throw new BadRequestException('Display name is required to complete onboarding');
      if (!user.gender)
        throw new BadRequestException('Gender is required to complete onboarding');
      if (user.interests.length < 3)
        throw new BadRequestException('At least 3 interests are required');
      if (!user.username)
        throw new BadRequestException('Username is required to complete onboarding');

      await this.prisma.user.update({
        where: { id: userId },
        data: { isOnboardingComplete: true, onboardingStep: 7 },
      });

      return { message: 'Onboarding complete! Welcome to NearConnect.', data: null };
    } catch (error) {
      catchBlock(error);
    }
  }
}
