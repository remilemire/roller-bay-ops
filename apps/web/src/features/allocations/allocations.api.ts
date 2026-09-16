import { queryOptions } from '@tanstack/react-query';
import * as s from '@roller-bay/shared/allocations';
import { api, noContent, queryString } from '@/lib/api';
export const allocationKey = ['allocations'] as const;
export const allocationList = (filters: Record<string, unknown> = {}) =>
  queryOptions({
    queryKey: [...allocationKey, 'list', filters],
    queryFn: ({ signal }) =>
      api(
        `/allocations${queryString({ pageSize: 25, ...filters })}`,
        s.allocationListSchema,
        { signal },
      ),
  });
export const allocationDetail = (id: string) =>
  queryOptions({
    queryKey: [...allocationKey, id],
    queryFn: ({ signal }) =>
      api(`/allocations/${id}`, s.allocationRecordSchema, { signal }),
  });
export const createAllocationDraft = (
  data: s.AllocationDraftData,
  key: string,
) =>
  api('/allocations/drafts', s.allocationDraftSchema, {
    method: 'POST',
    body: { data: s.allocationDraftDataSchema.parse(data) },
    key,
  });
export const saveAllocationDraft = (
  id: string,
  expectedRevision: number,
  data: s.AllocationDraftData,
) =>
  api(`/allocations/${id}/draft`, s.allocationDraftSchema, {
    method: 'PUT',
    body: { expectedRevision, data: s.allocationDraftDataSchema.parse(data) },
  });
export const submitAllocation = (id: string, expectedRevision: number) =>
  api(`/allocations/${id}/submit`, s.allocationDetailSchema, {
    method: 'POST',
    body: { expectedRevision },
  });
export const replaceAllocation = (id: string, body: unknown) =>
  api(`/allocations/${id}`, s.allocationDetailSchema, {
    method: 'PUT',
    body: s.replaceAllocationSchema.parse(body),
  });
export const deleteAllocationDraft = (id: string, expectedRevision: number) =>
  api(`/allocations/${id}/draft`, noContent, {
    method: 'DELETE',
    body: { expectedRevision },
  });
export const optimizeAllocation = (body: unknown, signal?: AbortSignal) =>
  api('/allocations/optimize', s.allocationOptimizationSchema, {
    method: 'POST',
    body: s.optimizeAllocationSchema.parse(body),
    signal,
  });
export const validateAllocation = (body: unknown) =>
  api('/allocations/validate', s.allocationValidationSchema, {
    method: 'POST',
    body: s.validateAllocationSchema.parse(body),
  });
export const cancelAllocation = (id: string, expectedRevision: number) =>
  api(`/allocations/${id}/cancel`, s.allocationDetailSchema, {
    method: 'POST',
    body: { expectedRevision },
  });
export const completeAllocation = (id: string, body: unknown, key: string) =>
  api(`/allocations/${id}/complete`, s.allocationDetailSchema, {
    method: 'POST',
    body: s.completeAllocationSchema.parse(body),
    key,
  });
