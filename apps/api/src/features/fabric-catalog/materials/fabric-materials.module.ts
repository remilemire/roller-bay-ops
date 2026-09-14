import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { FabricMaterialsController } from './fabric-materials.controller.js';
import { FabricMaterialsService } from './fabric-materials.service.js';
import { FabricMaterialsRepository } from './fabric-materials.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [FabricMaterialsController],
  providers: [FabricMaterialsService, FabricMaterialsRepository],
})
export class FabricMaterialsModule {}
