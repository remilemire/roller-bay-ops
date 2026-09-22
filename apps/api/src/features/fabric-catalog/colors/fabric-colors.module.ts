import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { DatabaseService } from '../../../database/database.service.js';
import { UnitOfWorkModule } from '../../../unit-of-work/unit-of-work.module.js';
import { FabricColorsController } from './fabric-colors.controller.js';
import { FabricColorsRepository } from './fabric-colors.repository.js';
import { FabricColorsService } from './fabric-colors.service.js';
@Module({
  imports: [UnitOfWorkModule, DatabaseModule],
  controllers: [FabricColorsController],
  providers: [
    FabricColorsService,
    {
      provide: FabricColorsRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new FabricColorsRepository(database.db),
    },
  ],
})
export class FabricColorsModule {}
