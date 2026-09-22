import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DatabaseService } from '../../database/database.service.js';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';
@Module({
  imports: [UnitOfWorkModule, DatabaseModule],
  controllers: [UsersController],
  providers: [
    {
      provide: UsersRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new UsersRepository(database.db),
    },
    UsersService,
  ],
  exports: [UsersService],
})
export class UsersModule {}
