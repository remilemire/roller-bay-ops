import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesRepository } from './employees.repository.js';
import { EmployeesService } from './employees.service.js';
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [EmployeesController],
  providers: [EmployeesRepository, EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
