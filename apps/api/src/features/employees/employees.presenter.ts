import { employeeSchema } from '@roller-bay/shared/employees';
import type { EmployeeRecord } from './employees.table.js';
export const presentEmployee = (row: EmployeeRecord) =>
  employeeSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });
