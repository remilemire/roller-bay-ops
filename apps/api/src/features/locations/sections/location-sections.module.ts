import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { LocationSectionsController } from './location-sections.controller.js';
import { LocationSectionsService } from './location-sections.service.js';
import { LocationSectionsRepository } from './location-sections.repository.js';

import { LocationOrderService } from '../location-order.service.js';
import { LocationOrderRepository } from '../location-order.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [LocationSectionsController],
  providers: [
    LocationOrderService,
    LocationOrderRepository,
    LocationSectionsService,
    LocationSectionsRepository,
  ],
})
export class LocationSectionsModule {}
