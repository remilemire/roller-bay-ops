import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { DatabaseService } from '../../../database/database.service.js';
import { UnitOfWorkModule } from '../../../unit-of-work/unit-of-work.module.js';
import { ManufacturersController } from './manufacturers.controller.js';
import { ManufacturersRepository } from './manufacturers.repository.js';
import { ManufacturersService } from './manufacturers.service.js';
@Module({
  imports: [UnitOfWorkModule, DatabaseModule],
  controllers: [ManufacturersController],
  providers: [
    ManufacturersService,
    {
      provide: ManufacturersRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new ManufacturersRepository(database.db),
    },
  ],
})
export class ManufacturersModule {}
