import { WorkOrderProductionService } from './work-order-production.service.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { WorkOrdersController } from './work-orders.controller.js';
import { WorkOrdersRepository } from './work-orders.repository.js';
import { WorkOrdersService } from './work-orders.service.js';

@Module({
  imports: [AuditModule, DatabaseModule],
  controllers: [WorkOrdersController],
  providers: [
    WorkOrdersService,
    WorkOrdersRepository,
    WorkOrderProductionService,
  ],
  exports: [WorkOrdersService, WorkOrderProductionService],
})
export class WorkOrdersModule {}
