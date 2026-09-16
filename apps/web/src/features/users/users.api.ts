import {
  userSchema,
  type UpdateMeasurementUnits,
} from '@roller-bay/shared/users';
import { api } from '@/lib/api';
export const updateMeasurementUnits = (patch: UpdateMeasurementUnits) =>
  api('/users/me/measurement-units', userSchema, {
    method: 'PATCH',
    body: patch,
  });
