import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { LocationSectionsController } from './location-sections.controller.js';
import { LocationSectionsService } from './location-sections.service.js';
import { LocationSectionsRepository } from './location-sections.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [LocationSectionsController],
  providers: [LocationSectionsService, LocationSectionsRepository],
})
export class LocationSectionsModule {}
