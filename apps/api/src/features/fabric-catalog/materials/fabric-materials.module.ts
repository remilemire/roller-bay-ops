import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { DatabaseService } from '../../../database/database.service.js';
import { UnitOfWorkModule } from '../../../unit-of-work/unit-of-work.module.js';
import { FabricMaterialsController } from './fabric-materials.controller.js';
import { FabricMaterialsRepository } from './fabric-materials.repository.js';
import { FabricMaterialsService } from './fabric-materials.service.js';
@Module({
  imports: [UnitOfWorkModule, DatabaseModule],
  controllers: [FabricMaterialsController],
  providers: [
    FabricMaterialsService,
    {
      provide: FabricMaterialsRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new FabricMaterialsRepository(database.db),
    },
  ],
})
export class FabricMaterialsModule {}
