import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // Config — available globally across all modules
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Rate-limiting defaults — individual routes can override via @Throttle()
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,  // 1 minute
          limit: 60,    // 60 requests/min per IP (global fallback)
        },
      ],
    }),

    PrismaModule,
    AuthModule,
  ],
})
export class AppModule {}
