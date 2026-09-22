import { AuditModule } from '../audit/audit.module.js';
import { CuttingWorksheetsModule } from '../cutting-worksheets/cutting-worksheets.module.js';
import { StockItemsModule } from '../stock-items/stock-items.module.js';
import { ProductionService } from './production.service.js';
import { CuttingWorkflowService } from './cutting-workflow.service.js';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { CuttingStationController } from './cutting-station.controller.js';
import { LocationsModule } from '../locations/locations.module.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { WorkOrdersModule } from '../work-orders/work-orders.module.js';
import { ProductionController } from './production.controller.js';
import { ProductionRepository } from './production.repository.js';
@Module({
  imports: [
    LocationsModule,
    AuditModule,
    CuttingWorksheetsModule,
    StockItemsModule,
    AllocationsModule,
    DatabaseModule,
    EmployeesModule,
    WorkOrdersModule,
  ],
  controllers: [ProductionController, CuttingStationController],
  providers: [ProductionRepository, ProductionService, CuttingWorkflowService],
})
export class ProductionModule {}
