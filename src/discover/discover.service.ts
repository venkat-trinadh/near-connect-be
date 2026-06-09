import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { catchBlock } from '../common/util/CatchBlock';
import type { DiscoverQueryDto } from './dto/discover-query.dto';

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
}

function profileCompleteness(user: {
  bio: string | null;
  avatarId: string | null;
  interests: string[];
  locationArea: string | null;
}): number {
  let score = 0;
  if (user.bio) score += 0.25;
  if (user.avatarId) score += 0.25;
  if (user.interests.length >= 3) score += 0.25;
  if (user.locationArea) score += 0.25;
  return score;
}

function interestScore(myInterests: string[], theirInterests: string[]): number {
  if (!myInterests.length || !theirInterests.length) return 0;
  const overlap = myInterests.filter((i) => theirInterests.includes(i)).length;
  return overlap / Math.max(myInterests.length, theirInterests.length);
}

@Injectable()
export class DiscoverService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async getExcludedIds(userId: number): Promise<Set<number>> {
    const [requests, blocks] = await Promise.all([
      this.prisma.connectionRequest.findMany({
        where: {
          OR: [{ senderId: userId }, { receiverId: userId }],
          status: { in: ['PENDING', 'ACCEPTED'] },
        },
        select: { senderId: true, receiverId: true },
      }),
      this.prisma.block.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        select: { blockerId: true, blockedId: true },
      }),
    ]);

    const excluded = new Set<number>([userId]);

    for (const r of requests) {
      excluded.add(r.senderId);
      excluded.add(r.receiverId);
    }
    for (const b of blocks) {
      excluded.add(b.blockerId);
      excluded.add(b.blockedId);
    }

    return excluded;
  }

  private latLngBounds(lat: number, lng: number, radiusKm: number) {
    const latDelta = radiusKm / 111.32;
    const lngDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
    return {
      minLat: lat - latDelta,
      maxLat: lat + latDelta,
      minLng: lng - lngDelta,
      maxLng: lng + lngDelta,
    };
  }

  // ─── Get public profile of a specific user ────────────────────────────────

  async getUserProfile(requesterId: number, targetUserId: number) {
    try {
      // Check for block in either direction
      const block = await this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: requesterId, blockedId: targetUserId },
            { blockerId: targetUserId, blockedId: requesterId },
          ],
        },
      });
      if (block) throw new NotFoundException('User not found');

      const user = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: {
          id: true,
          displayName: true,
          username: true,
          avatarId: true,
          bio: true,
          interests: true,
          locationArea: true,
          latitude: true,
          longitude: true,
          occupation: true,
          languages: true,
          isEmailVerified: true,
          isPhoneVerified: true,
          createdAt: true,
          isOnboardingComplete: true,
        },
      });

      if (!user || !user.isOnboardingComplete) throw new NotFoundException('User not found');

      // Get requester's interests for shared-interest computation
      const me = await this.prisma.user.findUnique({
        where: { id: requesterId },
        select: { interests: true, latitude: true, longitude: true },
      });

      const sharedInterests = me
        ? me.interests.filter((i) => user.interests.includes(i))
        : [];
      const otherInterests = user.interests.filter((i) => !sharedInterests.includes(i));

      // Distance (if both have coordinates)
      let distance: string | null = null;
      if (me?.latitude && me?.longitude && user.latitude && user.longitude) {
        const distKm = haversineKm(me.latitude, me.longitude, user.latitude, user.longitude);
        distance = distKm < 1
          ? `${Math.round(distKm * 1000)} m`
          : `${distKm.toFixed(1)} km`;
      }

      const joinedMs = Date.now() - new Date(user.createdAt).getTime();
      const joinedDays = Math.floor(joinedMs / (1000 * 60 * 60 * 24));
      const joined =
        joinedDays < 7
          ? `${joinedDays} day${joinedDays !== 1 ? 's' : ''} ago`
          : joinedDays < 30
            ? `${Math.floor(joinedDays / 7)} week${Math.floor(joinedDays / 7) !== 1 ? 's' : ''} ago`
            : joinedDays < 365
              ? `${Math.floor(joinedDays / 30)} month${Math.floor(joinedDays / 30) !== 1 ? 's' : ''} ago`
              : `${Math.floor(joinedDays / 365)} year${Math.floor(joinedDays / 365) !== 1 ? 's' : ''} ago`;

      return {
        message: 'Profile fetched',
        data: {
          id: user.id,
          name: user.displayName,
          username: user.username,
          avatarId: user.avatarId,
          bio: user.bio ?? '',
          area: user.locationArea ?? 'Nearby',
          distance,
          sharedInterests,
          otherInterests,
          interests: user.interests,
          occupation: user.occupation ?? null,
          languages: user.languages,
          verified: user.isEmailVerified || user.isPhoneVerified,
          joined,
        },
      };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Count nearby ─────────────────────────────────────────────────────────

  async getCount(userId: number, dto: DiscoverQueryDto) {
    try {
      // Always refresh the caller's stored location so they stay discoverable.
      // Fire-and-forget — do not await; never blocks the response.
      this.prisma.user
        .update({
          where: { id: userId },
          data: {
            latitude: dto.lat,
            longitude: dto.lng,
            locationGranted: true,
            ...(dto.area ? { locationArea: dto.area } : {}),
          },
        })
        .catch(() => null);

      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { locationArea: true },
      });
      if (!me) throw new NotFoundException('User not found');

      const radius = dto.radius ?? 10;
      const bounds = this.latLngBounds(dto.lat, dto.lng, radius);
      const excluded = await this.getExcludedIds(userId);

      const candidates = await this.prisma.user.findMany({
        where: {
          isOnboardingComplete: true,
          locationGranted: true,
          latitude: { gte: bounds.minLat, lte: bounds.maxLat },
          longitude: { gte: bounds.minLng, lte: bounds.maxLng },
          id: { notIn: Array.from(excluded) },
        },
        select: { id: true, latitude: true, longitude: true },
      });

      const count = candidates.filter(
        (u) => haversineKm(dto.lat, dto.lng, u.latitude!, u.longitude!) <= radius,
      ).length;

      return {
        message: 'Nearby count fetched',
        data: { count, area: me.locationArea ?? 'Your area' },
      };
    } catch (error) {
      catchBlock(error);
    }
  }

  // ─── Next person ──────────────────────────────────────────────────────────

  async getNext(userId: number, dto: DiscoverQueryDto) {
    try {
      // Refresh caller's location on every search call as well.
      this.prisma.user
        .update({
          where: { id: userId },
          data: {
            latitude: dto.lat,
            longitude: dto.lng,
            locationGranted: true,
            ...(dto.area ? { locationArea: dto.area } : {}),
          },
        })
        .catch(() => null);

      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { interests: true },
      });
      if (!me) throw new NotFoundException('User not found');

      const radius = dto.radius ?? 10;
      const seen = dto.seen ?? [];
      const bounds = this.latLngBounds(dto.lat, dto.lng, radius);
      const excluded = await this.getExcludedIds(userId);

      // also exclude seen[] for this session
      for (const id of seen) excluded.add(id);

      const candidates = await this.prisma.user.findMany({
        where: {
          isOnboardingComplete: true,
          locationGranted: true,
          latitude: { gte: bounds.minLat, lte: bounds.maxLat },
          longitude: { gte: bounds.minLng, lte: bounds.maxLng },
          id: { notIn: Array.from(excluded) },
        },
        select: {
          id: true,
          displayName: true,
          username: true,
          avatarId: true,
          bio: true,
          interests: true,
          locationArea: true,
          latitude: true,
          longitude: true,
          isEmailVerified: true,
          isPhoneVerified: true,
          occupation: true,
          languages: true,
          createdAt: true,
        },
      });

      console.log(`Discover: found ${candidates.length} candidates in bounding box, filtering by exact distance...`, candidates);

      // exact haversine filter
      const inRadius = candidates.filter(
        (u) => haversineKm(dto.lat, dto.lng, u.latitude!, u.longitude!) <= radius,
      );

      if (!inRadius.length) return null; // caller returns 204

      // rank: 40% distance + 40% interests + 20% completeness
      const maxDist = Math.max(...inRadius.map((u) => haversineKm(dto.lat, dto.lng, u.latitude!, u.longitude!)));

      const ranked = inRadius
        .map((u) => {
          const dist = haversineKm(dto.lat, dto.lng, u.latitude!, u.longitude!);
          const distScore = maxDist > 0 ? 1 - dist / maxDist : 1;
          const interScore = interestScore(me.interests, u.interests);
          const compScore = profileCompleteness(u);
          const total = 0.4 * distScore + 0.4 * interScore + 0.2 * compScore;
          return { ...u, _dist: dist, _score: total };
        })
        .sort((a, b) => b._score - a._score);

      const best = ranked[0];
      console.log(`Discover: best match user ${best.id}`, best);
      const distKm = best._dist;

      const sharedInterests = me.interests.filter((i) => best.interests.includes(i));
      const otherInterests = best.interests.filter((i) => !me.interests.includes(i));

      const joinedMs = Date.now() - new Date(best.createdAt).getTime();
      const joinedDays = Math.floor(joinedMs / (1000 * 60 * 60 * 24));
      const joined =
        joinedDays < 7
          ? `${joinedDays} day${joinedDays !== 1 ? 's' : ''} ago`
          : joinedDays < 30
            ? `${Math.floor(joinedDays / 7)} week${Math.floor(joinedDays / 7) !== 1 ? 's' : ''} ago`
            : joinedDays < 365
              ? `${Math.floor(joinedDays / 30)} month${Math.floor(joinedDays / 30) !== 1 ? 's' : ''} ago`
              : `${Math.floor(joinedDays / 365)} year${Math.floor(joinedDays / 365) !== 1 ? 's' : ''} ago`;

      return {
        message: 'Next person fetched',
        data: {
          id: best.id,
          name: best.displayName,
          username: best.username,
          avatarId: best.avatarId,
          distance: distKm < 1 ? `${Math.round(distKm * 1000)} m` : `${distKm.toFixed(1)} km`,
          distanceKm: parseFloat(distKm.toFixed(2)),
          area: best.locationArea ?? 'Nearby',
          bio: best.bio ?? '',
          sharedInterests,
          otherInterests,
          interests: best.interests,
          occupation: best.occupation ?? null,
          languages: best.languages,
          verified: best.isEmailVerified || best.isPhoneVerified,
          joined,
        },
      };
    } catch (error) {
      catchBlock(error);
    }
  }
}
