import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { LocationLevelsController } from './location-levels.controller.js';
import { LocationLevelsService } from './location-levels.service.js';
import { LocationLevelsRepository } from './location-levels.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [LocationLevelsController],
  providers: [LocationLevelsService, LocationLevelsRepository],
})
export class LocationLevelsModule {}
