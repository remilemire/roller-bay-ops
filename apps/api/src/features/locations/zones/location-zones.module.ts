import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { LocationZonesController } from './location-zones.controller.js';
import { LocationZonesService } from './location-zones.service.js';
import { LocationZonesRepository } from './location-zones.repository.js';

import { LocationOrderService } from '../location-order.service.js';
import { LocationOrderRepository } from '../location-order.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [LocationZonesController],
  providers: [
    LocationOrderService,
    LocationOrderRepository,
    LocationZonesService,
    LocationZonesRepository,
  ],
})
export class LocationZonesModule {}
