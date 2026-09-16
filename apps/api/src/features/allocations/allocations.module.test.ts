import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigModule } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service.js';
import { AllocationsModule } from './allocations.module.js';
import { AllocationsController } from './allocations.controller.js';
import { AllocationPlanningService } from './allocation-planning.service.js';
import { SolverClient } from '../../solver/solver.client.js';
import { fixture } from './optimizer/optimizer.fixtures.js';

test('allocation module starts without solver credentials and only optimization reports unavailable', async () => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => ({ SOLVER_URL: 'http://127.0.0.1:8001' })],
      }),
      AllocationsModule,
    ],
  })
    .overrideProvider(DatabaseService)
    .useValue({ db: {} })
    .compile();
  try {
    assert.ok(module.get(AllocationsController));
    assert.equal(module.get(SolverClient), null);
    const { requirements } = fixture();
    await assert.rejects(
      module
        .get(AllocationPlanningService)
        .optimize({ requirements, maxTimeSeconds: 5 }),
      ServiceUnavailableException,
    );
  } finally {
    await module.close();
  }
});
