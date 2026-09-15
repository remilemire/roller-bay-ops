import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { StockItemsController } from './stock-items.controller.js';
import { StockItemsService } from './stock-items.service.js';
import { StockItemsRepository } from './stock-items.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [StockItemsController],
  providers: [StockItemsService, StockItemsRepository],
})
export class StockItemsModule {}
