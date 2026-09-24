import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type EmployeeInput,
  type EmployeeUpdate,
} from '@roller-bay/shared/employees';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/index.js';
import { presentEmployee } from './employees.presenter.js';
import { EmployeesRepository } from './employees.repository.js';
@Injectable()
export class EmployeesService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: EmployeesRepository,
    private readonly audit: AuditService,
  ) {}
  async requireActive(context: UnitOfWorkContext, id: string) {
    const row = await context.employees.find(id, true);
    if (!row?.isActive)
      throw new ConflictException('Choose an active employee.');
    return presentEmployee(row);
  }
  /** Resolves every id, in the requested order, or rejects the whole list. */
  async requireActiveMany(context: UnitOfWorkContext, ids: string[]) {
    const rows = await context.employees.findMany(ids, true);
    return ids.map((id) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new ConflictException('Choose active employees.');
      if (!row.isActive)
        throw new ConflictException(`${row.name} is no longer active.`);
      return presentEmployee(row);
    });
  }
  async list(activeOnly = false) {
    return (await this.repository.list(activeOnly)).map(presentEmployee);
  }
  create(input: EmployeeInput, actor: string) {
    return this.unitOfWork.transaction(async (context) => {
      const result = presentEmployee(await context.employees.create(input));
      await this.audit.record(context, actor, 'employee.created', [
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
    return this.unitOfWork.transaction(async (context) => {
      const old = await context.employees.lock(id);
      if (!old) throw new NotFoundException('Employee not found.');
      if (old.revision !== input.expectedRevision)
        throw new ConflictException('Employee changed; refresh before saving.');
      const { expectedRevision: _, ...values } = input;
      void _;
      const result = presentEmployee(
        await context.employees.update(id, values),
      );
      await this.audit.record(context, actor, 'employee.updated', [
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
