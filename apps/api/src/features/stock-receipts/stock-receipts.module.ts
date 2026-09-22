import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DatabaseService } from '../../database/database.service.js';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { StockItemsModule } from '../stock-items/stock-items.module.js';
import { StockReceiptsController } from './stock-receipts.controller.js';
import { StockReceiptsRepository } from './stock-receipts.repository.js';
import { StockReceiptsService } from './stock-receipts.service.js';
@Module({
  imports: [UnitOfWorkModule, AuditModule, DatabaseModule, StockItemsModule],
  controllers: [StockReceiptsController],
  providers: [
    {
      provide: StockReceiptsRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new StockReceiptsRepository(database.db),
    },
    StockReceiptsService,
  ],
})
export class StockReceiptsModule {}
