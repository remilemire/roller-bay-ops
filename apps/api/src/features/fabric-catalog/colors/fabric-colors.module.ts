import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { FabricColorsController } from './fabric-colors.controller.js';
import { FabricColorsService } from './fabric-colors.service.js';
import { FabricColorsRepository } from './fabric-colors.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [FabricColorsController],
  providers: [FabricColorsService, FabricColorsRepository],
})
export class FabricColorsModule {}
