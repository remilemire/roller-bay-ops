import { Module } from '@nestjs/common';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { WorkOrdersModule } from '../work-orders/work-orders.module.js';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { CuttingWorksheetsModule } from '../cutting-worksheets/cutting-worksheets.module.js';
import { WorkOrderWorkflowsController } from './work-order-workflows.controller.js';
import { WorkOrderWorkflowsService } from './work-order-workflows.service.js';
@Module({
  imports: [
    UnitOfWorkModule,
    AuditModule,
    WorkOrdersModule,
    AllocationsModule,
    CuttingWorksheetsModule,
  ],
  controllers: [WorkOrderWorkflowsController],
  providers: [WorkOrderWorkflowsService],
})
export class WorkOrderWorkflowsModule {}
