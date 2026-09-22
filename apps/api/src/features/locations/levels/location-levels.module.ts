import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { DatabaseService } from '../../../database/database.service.js';
import { UnitOfWorkModule } from '../../../unit-of-work/unit-of-work.module.js';
import { LocationOrderRepository } from '../location-order.repository.js';
import { LocationOrderService } from '../location-order.service.js';
import { LocationLevelsController } from './location-levels.controller.js';
import { LocationLevelsRepository } from './location-levels.repository.js';
import { LocationLevelsService } from './location-levels.service.js';
@Module({
  imports: [UnitOfWorkModule, DatabaseModule],
  exports: [LocationLevelsService],
  controllers: [LocationLevelsController],
  providers: [
    LocationOrderService,
    {
      provide: LocationOrderRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new LocationOrderRepository(database.db),
    },
    LocationLevelsService,
    {
      provide: LocationLevelsRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new LocationLevelsRepository(database.db),
    },
  ],
})
export class LocationLevelsModule {}
