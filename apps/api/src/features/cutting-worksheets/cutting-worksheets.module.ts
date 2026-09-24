import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DatabaseService } from '../../database/database.service.js';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AuditModule } from '../audit/index.js';
import { EmployeesModule } from '../employees/index.js';
import { CuttingWorksheetsRepository } from './cutting-worksheets.repository.js';
import { CuttingWorksheetsService } from './cutting-worksheets.service.js';
@Module({
  imports: [UnitOfWorkModule, DatabaseModule, AuditModule, EmployeesModule],
  providers: [
    {
      provide: CuttingWorksheetsRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new CuttingWorksheetsRepository(database.db),
    },
    CuttingWorksheetsService,
  ],
  exports: [CuttingWorksheetsService],
})
export class CuttingWorksheetsModule {}
