import { CuttingWorksheetsService } from './cutting-worksheets.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module.js';
import type { Environment } from '../../config/environment.js';
import { SolverModule } from '../../solver/solver.module.js';
import { SolverClient } from '../../solver/solver.client.js';
import { WorkOrdersModule } from '../work-orders/work-orders.module.js';
import { StockItemsModule } from '../stock-items/stock-items.module.js';
import { AllocationsController } from './allocations.controller.js';
import { AllocationsRepository } from './allocations.repository.js';
import { AllocationsService } from './allocations.service.js';
import { AllocationPlanningService } from './allocation-planning.service.js';
import { CuttingRulesService } from './cutting-rules.service.js';
import { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';

@Module({
  imports: [
    AuditModule,
    ConfigModule,
    DatabaseModule,
    WorkOrdersModule,
    StockItemsModule,
    SolverModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => {
        const apiKey = config.get('SOLVER_API_KEY', { infer: true });
        return apiKey
          ? { baseUrl: config.get('SOLVER_URL', { infer: true }), apiKey }
          : null;
      },
    }),
  ],
  exports: [CuttingWorksheetsService],
  controllers: [AllocationsController],
  providers: [
    CuttingWorksheetsService,
    CuttingRulesService,
    AllocationsRepository,
    AllocationsService,
    AllocationPlanningService,
    {
      provide: CuttingPlanOptimizer,
      inject: [SolverClient],
      useFactory: (client: SolverClient | null) =>
        client ? new CuttingPlanOptimizer(client) : null,
    },
  ],
})
export class AllocationsModule {}
