import { Module } from '@nestjs/common';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AuditModule } from '../audit/index.js';
import { WorkOrdersModule } from '../work-orders/index.js';
import { AllocationsModule } from '../allocations/index.js';
import { WorkOrderCancellationController } from './work-order-cancellation.controller.js';
import { WorkOrderCancellationService } from './work-order-cancellation.service.js';
@Module({
  imports: [UnitOfWorkModule, AuditModule, WorkOrdersModule, AllocationsModule],
  controllers: [WorkOrderCancellationController],
  providers: [WorkOrderCancellationService],
})
export class WorkOrderCancellationModule {}
