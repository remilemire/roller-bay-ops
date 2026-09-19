import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { OrderScheduleController } from './order-schedule.controller.js';
import { OrderScheduleRepository } from './order-schedule.repository.js';
import { OrderScheduleService } from './order-schedule.service.js';

@Module({
  imports: [AuditModule, DatabaseModule],
  controllers: [OrderScheduleController],
  providers: [OrderScheduleService, OrderScheduleRepository],
  exports: [OrderScheduleService],
})
export class OrderScheduleModule {}
