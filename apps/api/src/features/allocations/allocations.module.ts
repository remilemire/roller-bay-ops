import { PlanningJobsService } from './planning-jobs.service.js';
import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';
import { DatabaseModule } from '../../database/database.module.js';
import { DatabaseService } from '../../database/database.service.js';
import { SolverClient } from '../../solver/solver.client.js';
import { SolverModule } from '../../solver/solver.module.js';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AuditModule } from '../audit/index.js';
import { CuttingWorksheetsModule } from '../cutting-worksheets/index.js';
import { StockItemsModule } from '../stock-items/index.js';
import { WorkOrdersModule } from '../work-orders/index.js';
import { AllocationDetailsService } from './allocation-details.service.js';
import { AllocationPlanningService } from './allocation-planning.service.js';
import { AllocationsController } from './allocations.controller.js';
import { AllocationsRepository } from './allocations.repository.js';
import { AllocationsService } from './allocations.service.js';
import { CompletionCorrectionsService } from './completion-corrections.service.js';
import { CuttingRulesService } from './cutting-rules.service.js';
import { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';
@Module({
  imports: [
    UnitOfWorkModule,
    AuditModule,
    CuttingWorksheetsModule,
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
  exports: [AllocationsService],
  controllers: [AllocationsController],
  providers: [
    CuttingRulesService,
    {
      provide: AllocationsRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new AllocationsRepository(database.db),
    },
    AllocationDetailsService,
    AllocationsService,
    AllocationPlanningService,
    PlanningJobsService,
    CompletionCorrectionsService,
    {
      provide: CuttingPlanOptimizer,
      inject: [SolverClient, ConfigService],
      useFactory: (
        client: SolverClient | null,
        config: ConfigService<Environment, true>,
      ) =>
        new CuttingPlanOptimizer(
          client,
          {
            CUTTING_MAX_BLINDS: config.getOrThrow('CUTTING_MAX_BLINDS', {
              infer: true,
            }),
            CUTTING_REFINEMENT_SECONDS: config.getOrThrow(
              'CUTTING_REFINEMENT_SECONDS',
              { infer: true },
            ),
            CUTTING_MAX_PATTERNS: config.getOrThrow('CUTTING_MAX_PATTERNS', {
              infer: true,
            }),
            CUTTING_MAX_PATTERN_NODES: config.getOrThrow(
              'CUTTING_MAX_PATTERN_NODES',
              { infer: true },
            ),
            CUTTING_MAX_ASSIGNMENTS: config.getOrThrow(
              'CUTTING_MAX_ASSIGNMENTS',
              { infer: true },
            ),
          },
          (error) =>
            Logger.warn(
              error instanceof Error
                ? error.message
                : 'Cutting refinement failed',
              CuttingPlanOptimizer.name,
            ),
        ),
    },
  ],
})
export class AllocationsModule {}
