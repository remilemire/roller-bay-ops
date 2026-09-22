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
    AllocationsModule,
    DatabaseModule,
    EmployeesModule,
    WorkOrdersModule,
  ],
  controllers: [ProductionController, CuttingStationController],
  providers: [ProductionRepository],
})
export class ProductionModule {}
