import {
  ownershipTransferResultSchema,
  transferOwnershipSchema,
  updateUserActivationSchema,
  updateUserRoleSchema,
  userListSchema,
  userSchema,
  type UpdateMeasurementUnits,
  type UpdateUserRole,
} from '@roller-bay/shared/users';
import { api, queryString } from '@/lib/api';
export const usersKey = ['users'] as const;
export const updateMeasurementUnits = (patch: UpdateMeasurementUnits) =>
  api('/users/me/measurement-units', userSchema, {
    method: 'PATCH',
    body: patch,
  });
export const listUsers = (search: string, page: number, signal?: AbortSignal) =>
  api(`/users${queryString({ search, page, pageSize: 25 })}`, userListSchema, {
    signal,
  });
export const setUserRole = (id: string, role: UpdateUserRole['role']) =>
  api(`/users/${id}/role`, userSchema, {
    method: 'PATCH',
    body: updateUserRoleSchema.parse({ role }),
  });
export const setUserActivation = (id: string, isActive: boolean) =>
  api(`/users/${id}/activation`, userSchema, {
    method: 'PATCH',
    body: updateUserActivationSchema.parse({ isActive }),
  });
export const transferOwnership = (newOwnerId: string) =>
  api('/users/transfer-ownership', ownershipTransferResultSchema, {
    method: 'POST',
    body: transferOwnershipSchema.parse({ newOwnerId }),
  });
