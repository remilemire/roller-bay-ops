import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './features/health/health.module.js';
import { NotesModule } from './features/notes/notes.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    RedisModule,
    HealthModule,
    NotesModule,
  ],
})
export class AppModule {}
