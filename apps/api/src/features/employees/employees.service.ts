import type { DatabaseTransaction } from '../../database/database.service.js';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type EmployeeInput,
  type EmployeeUpdate,
} from '@roller-bay/shared/employees';
import { AuditService } from '../audit/audit.service.js';
import { EmployeesRepository } from './employees.repository.js';
import { presentEmployee } from './employees.presenter.js';
@Injectable()
export class EmployeesService {
  constructor(
    private readonly repository: EmployeesRepository,
    private readonly audit: AuditService,
  ) {}
  async requireActive(tx: DatabaseTransaction, id: string) {
    const row = await this.repository.find(id, true, tx);
    if (!row?.isActive)
      throw new ConflictException('Choose an active employee.');
    return presentEmployee(row);
  }
  async list(activeOnly = false) {
    return (await this.repository.list(activeOnly)).map(presentEmployee);
  }
  create(input: EmployeeInput, actor: string) {
    return this.repository.transaction(async (repo, tx) => {
      const result = presentEmployee(await repo.create(input));
      await this.audit.record(tx, actor, 'employee.created', [
        {
          recordType: 'employees',
          recordId: result.id,
          before: null,
          after: { type: 'employees', value: result },
        },
      ]);
      return result;
    });
  }
  update(id: string, input: EmployeeUpdate, actor: string) {
    return this.repository.transaction(async (repo, tx) => {
      const old = await repo.lock(id);
      if (!old) throw new NotFoundException('Employee not found.');
      if (old.revision !== input.expectedRevision)
        throw new ConflictException('Employee changed; refresh before saving.');
      const { expectedRevision: _, ...values } = input;
      void _;
      const result = presentEmployee(await repo.update(id, values));
      await this.audit.record(tx, actor, 'employee.updated', [
        {
          recordType: 'employees',
          recordId: id,
          before: { type: 'employees', value: presentEmployee(old) },
          after: { type: 'employees', value: result },
        },
      ]);
      return result;
    });
  }
}
