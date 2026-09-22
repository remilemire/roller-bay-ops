import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { DatabaseService } from '../../../database/database.service.js';
import { UnitOfWorkModule } from '../../../unit-of-work/unit-of-work.module.js';
import { LocationOrderRepository } from '../location-order.repository.js';
import { LocationOrderService } from '../location-order.service.js';
import { LocationZonesController } from './location-zones.controller.js';
import { LocationZonesRepository } from './location-zones.repository.js';
import { LocationZonesService } from './location-zones.service.js';
@Module({
  imports: [UnitOfWorkModule, DatabaseModule],
  controllers: [LocationZonesController],
  providers: [
    LocationOrderService,
    {
      provide: LocationOrderRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new LocationOrderRepository(database.db),
    },
    LocationZonesService,
    {
      provide: LocationZonesRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new LocationZonesRepository(database.db),
    },
  ],
})
export class LocationZonesModule {}
