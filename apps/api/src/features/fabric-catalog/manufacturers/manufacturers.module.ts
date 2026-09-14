import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { ManufacturersController } from './manufacturers.controller.js';
import { ManufacturersService } from './manufacturers.service.js';
import { ManufacturersRepository } from './manufacturers.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ManufacturersController],
  providers: [ManufacturersService, ManufacturersRepository],
})
export class ManufacturersModule {}
