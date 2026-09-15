import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { StockItemsModule } from '../stock-items/stock-items.module.js';
import { StockReceiptsController } from './stock-receipts.controller.js';
import { StockReceiptsRepository } from './stock-receipts.repository.js';
import { StockReceiptsService } from './stock-receipts.service.js';

@Module({
  imports: [DatabaseModule, StockItemsModule],
  controllers: [StockReceiptsController],
  providers: [StockReceiptsRepository, StockReceiptsService],
})
export class StockReceiptsModule {}
