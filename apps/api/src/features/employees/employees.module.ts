import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DatabaseService } from '../../database/database.service.js';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesRepository } from './employees.repository.js';
import { EmployeesService } from './employees.service.js';
@Module({
  imports: [UnitOfWorkModule, DatabaseModule, AuditModule],
  controllers: [EmployeesController],
  providers: [
    {
      provide: EmployeesRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new EmployeesRepository(database.db),
    },
    EmployeesService,
  ],
  exports: [EmployeesService],
})
export class EmployeesModule {}
