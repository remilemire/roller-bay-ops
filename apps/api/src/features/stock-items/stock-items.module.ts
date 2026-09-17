import { AuditModule } from '../audit/audit.module.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { StockItemsController } from './stock-items.controller.js';
import { StockItemsService } from './stock-items.service.js';
import { StockItemsRepository } from './stock-items.repository.js';

@Module({
  imports: [AuditModule, DatabaseModule],
  controllers: [StockItemsController],
  providers: [StockItemsService, StockItemsRepository],
  exports: [StockItemsService],
})
export class StockItemsModule {}
