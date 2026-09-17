import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { DatabaseModule } from '../../database/database.module.js';
import { RedisModule } from '../../redis/redis.module.js';
import { HealthService } from './health.service.js';

@Public()
@Controller('health')
class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  getHealth() {
    return { status: 'ok' };
  }

  @Get('ready')
  getReadiness() {
    return this.health.readiness();
  }

  @Get('solver')
  getSolverHealth() {
    return this.health.solver();
  }
}

@Module({
  imports: [DatabaseModule, RedisModule],
  providers: [HealthService],
  controllers: [HealthController],
})
export class HealthModule {}
