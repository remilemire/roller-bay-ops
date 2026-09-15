import { Module } from '@nestjs/common';
import { LocationZonesModule } from './zones/location-zones.module.js';
import { LocationSectionsModule } from './sections/location-sections.module.js';
import { LocationLevelsModule } from './levels/location-levels.module.js';

@Module({
  // Register static resource paths before the /locations/:id route.
  imports: [LocationZonesModule, LocationSectionsModule, LocationLevelsModule],
})
export class LocationsModule {}
