import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { DatabaseService } from '../../../database/database.service.js';
import { UnitOfWorkModule } from '../../../unit-of-work/unit-of-work.module.js';
import { LocationOrderRepository } from '../location-order.repository.js';
import { LocationOrderService } from '../location-order.service.js';
import { LocationSectionsController } from './location-sections.controller.js';
import { LocationSectionsRepository } from './location-sections.repository.js';
import { LocationSectionsService } from './location-sections.service.js';
@Module({
  imports: [UnitOfWorkModule, DatabaseModule],
  controllers: [LocationSectionsController],
  providers: [
    LocationOrderService,
    {
      provide: LocationOrderRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new LocationOrderRepository(database.db),
    },
    LocationSectionsService,
    {
      provide: LocationSectionsRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new LocationSectionsRepository(database.db),
    },
  ],
})
export class LocationSectionsModule {}
