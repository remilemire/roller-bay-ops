import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DatabaseService } from '../../database/database.service.js';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { StockCorrectionsService } from './stock-corrections.service.js';
import { StockItemsController } from './stock-items.controller.js';
import { StockItemsRepository } from './stock-items.repository.js';
import { StockItemsService } from './stock-items.service.js';
@Module({
  imports: [UnitOfWorkModule, AuditModule, DatabaseModule],
  controllers: [StockItemsController],
  providers: [
    StockItemsService,
    StockCorrectionsService,
    {
      provide: StockItemsRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new StockItemsRepository(database.db),
    },
  ],
  exports: [StockItemsService, StockCorrectionsService],
})
export class StockItemsModule {}
