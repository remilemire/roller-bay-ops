import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DatabaseService } from '../../database/database.service.js';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { WorkOrdersController } from './work-orders.controller.js';
import { WorkOrdersRepository } from './work-orders.repository.js';
import { WorkOrdersService } from './work-orders.service.js';
@Module({
  imports: [UnitOfWorkModule, AuditModule, DatabaseModule],
  controllers: [WorkOrdersController],
  providers: [
    WorkOrdersService,
    {
      provide: WorkOrdersRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new WorkOrdersRepository(database.db),
    },
  ],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
