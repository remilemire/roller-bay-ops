import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DatabaseService } from '../../database/database.service.js';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AllocationsModule } from '../allocations/index.js';
import { AuditModule } from '../audit/index.js';
import { CuttingWorksheetsModule } from '../cutting-worksheets/index.js';
import { EmployeesModule } from '../employees/index.js';
import { LocationsModule } from '../locations/index.js';
import { StockItemsModule } from '../stock-items/index.js';
import { WorkOrdersModule } from '../work-orders/index.js';
import { RecutsController } from './recuts.controller.js';
import { RecutsService } from './recuts.service.js';
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
  controllers: [
    RecutsController,
    ProductionController,
    CuttingStationController,
  ],
  providers: [
    {
      provide: ProductionRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new ProductionRepository(database.db),
    },
    RecutsService,
    ProductionService,
    CuttingWorkflowService,
  ],
})
export class ProductionModule {}
