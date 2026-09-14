import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';

@Public()
@Controller('health')
class HealthController {
  @Get()
  getHealth() {
    return { status: 'ok' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
