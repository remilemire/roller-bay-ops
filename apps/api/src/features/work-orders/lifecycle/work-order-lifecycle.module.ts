import { Module } from '@nestjs/common';
import { UnitOfWorkModule } from '../../../unit-of-work/unit-of-work.module.js';
import { AuditModule } from '../../audit/audit.module.js';
import { WorkOrdersModule } from '../work-orders.module.js';
import { AllocationsModule } from '../../allocations/allocations.module.js';
import { CuttingWorksheetsModule } from '../../cutting-worksheets/cutting-worksheets.module.js';
import { WorkOrderLifecycleController } from './work-order-lifecycle.controller.js';
import { WorkOrderLifecycleService } from './work-order-lifecycle.service.js';
@Module({
  imports: [
    UnitOfWorkModule,
    AuditModule,
    WorkOrdersModule,
    AllocationsModule,
    CuttingWorksheetsModule,
  ],
  controllers: [WorkOrderLifecycleController],
  providers: [WorkOrderLifecycleService],
})
export class WorkOrderLifecycleModule {}
