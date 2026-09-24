import { Module } from '@nestjs/common';
import { UnitOfWorkModule } from '../../../unit-of-work/unit-of-work.module.js';
import { AuditModule } from '../../audit/audit.module.js';
import { WorkOrdersModule } from '../work-orders.module.js';
import { AllocationsModule } from '../../allocations/allocations.module.js';
import { WorkOrderCancellationController } from './work-order-cancellation.controller.js';
import { WorkOrderCancellationService } from './work-order-cancellation.service.js';
@Module({
  imports: [UnitOfWorkModule, AuditModule, WorkOrdersModule, AllocationsModule],
  controllers: [WorkOrderCancellationController],
  providers: [WorkOrderCancellationService],
})
export class WorkOrderCancellationModule {}
