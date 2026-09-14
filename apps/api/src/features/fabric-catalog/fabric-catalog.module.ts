import { Module } from '@nestjs/common';
import { ManufacturersModule } from './manufacturers/manufacturers.module.js';
import { FabricMaterialsModule } from './materials/fabric-materials.module.js';
import { FabricColorsModule } from './colors/fabric-colors.module.js';

@Module({
  imports: [ManufacturersModule, FabricMaterialsModule, FabricColorsModule],
})
export class FabricCatalogModule {}
