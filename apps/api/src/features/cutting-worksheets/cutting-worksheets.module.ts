import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { CuttingWorksheetsRepository } from './cutting-worksheets.repository.js';
import { CuttingWorksheetsService } from './cutting-worksheets.service.js';
@Module({
  imports: [DatabaseModule, AuditModule, EmployeesModule],
  providers: [CuttingWorksheetsRepository, CuttingWorksheetsService],
  exports: [CuttingWorksheetsService],
})
export class CuttingWorksheetsModule {}
