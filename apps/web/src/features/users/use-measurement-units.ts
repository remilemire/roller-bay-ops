'use client';
import { useCurrentUser } from '@/features/auth';
/** The signed-in user's unit per measurement field, as served by the API. */
export function useMeasurementUnits() {
  return useCurrentUser().measurementUnits;
}
