import { planningDefaults } from '../../config/planning.js';
import { PlanningJobsService } from './planning-jobs.service.js';
import { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';
import { fixture } from './optimizer/optimizer.fixtures.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service.js';
import { AllocationsModule } from './allocations.module.js';
import { AllocationsController } from './allocations.controller.js';
import { SolverClient } from '../../solver/solver.client.js';

test('allocation module starts without solver credentials and generates a validated plan locally', async () => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [
          () => ({ ...planningDefaults, SOLVER_URL: 'http://127.0.0.1:8001' }),
        ],
      }),
      AllocationsModule,
    ],
  })
    .overrideProvider(PlanningJobsService)
    .useValue({})
    .overrideProvider(DatabaseService)
    .useValue({ db: {} })
    .compile();
  try {
    assert.ok(module.get(AllocationsController));
    assert.equal(module.get(SolverClient), null);
    assert.equal(
      (await module.get(CuttingPlanOptimizer).optimize(fixture())).status,
      'feasible',
    );
  } finally {
    await module.close();
  }
});
