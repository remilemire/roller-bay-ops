import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { UnitOfWork } from './unit-of-work.js';
@Module({
  imports: [DatabaseModule],
  providers: [UnitOfWork],
  exports: [UnitOfWork],
})
export class UnitOfWorkModule {}
