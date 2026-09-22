import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DatabaseService } from '../../database/database.service.js';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CuttingWorksheetsModule } from '../cutting-worksheets/cutting-worksheets.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { StockItemsModule } from '../stock-items/stock-items.module.js';
import { WorkOrdersModule } from '../work-orders/work-orders.module.js';
import { CuttingStationController } from './cutting-station.controller.js';
import { CuttingWorkflowService } from './cutting-workflow.service.js';
import { ProductionController } from './production.controller.js';
import { ProductionRepository } from './production.repository.js';
import { ProductionService } from './production.service.js';
@Module({
  imports: [
    UnitOfWorkModule,
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
  providers: [
    {
      provide: ProductionRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new ProductionRepository(database.db),
    },
    ProductionService,
    CuttingWorkflowService,
  ],
})
export class ProductionModule {}
