import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './features/health/health.module.js';
import { RedisModule } from './redis/redis.module.js';
import { FabricCatalogModule } from './features/fabric-catalog/fabric-catalog.module.js';
import { AuthModule } from './features/auth/auth.module.js';
import { RateLimitingModule } from './rate-limiting/rate-limiting.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    RedisModule,
    RateLimitingModule,
    AuthModule,
    HealthModule,
    FabricCatalogModule,
  ],
})
export class AppModule {}
