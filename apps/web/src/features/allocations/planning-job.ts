import {
  allocationPlanningJobSchema,
  optimizeAllocationSchema,
  type AllocationOptimization,
} from '@roller-bay/shared/allocations';
import { api, ApiError, noContent } from '@/lib/api';
import {
  finishRequest,
  pendingPayload,
  requestKey,
} from '@/lib/pending-request';

// A lost response, navigation, or polling failure leaves the request key in
// session storage. Submitting the same form reattaches to its original job.
export async function generatePlan(
  scope: string,
  input: unknown,
  signal: AbortSignal,
  onReady: (plan: AllocationOptimization) => void,
) {
  const body = optimizeAllocationSchema.parse(input);
  const previous = pendingPayload(scope);
  if (previous && JSON.stringify(previous) !== JSON.stringify(body)) {
    const previousId = requestKey(scope, previous);
    await cancel(previousId);
    finishRequest(scope);
  }
  const id = requestKey(scope, body);
  const path = `/allocations/planning-jobs/${id}`;
  let ready: AllocationOptimization | null = null;
  try {
    // Complete admission even if the user clicks Cancel during the PUT.
    // The subsequent DELETE must not race ahead of job creation.
    let state = await api(path, allocationPlanningJobSchema, {
      method: 'PUT',
      body,
    });
    for (;;) {
      signal.throwIfAborted();
      if (state.status === 'finished') {
        finishRequest(scope);
        return state.result;
      }
      if (state.status === 'failed') {
        finishRequest(scope);
        throw new ApiError(
          503,
          'The cutting search was interrupted. Generate a new plan.',
        );
      }
      if (state.status === 'cancelled') {
        finishRequest(scope);
        return null;
      }
      if (state.status === 'refining') {
        ready = state.result;
        onReady(ready);
      }
      await pause(signal);
      state = await api(path, allocationPlanningJobSchema, { signal });
    }
  } catch (error) {
    if (signal.aborted) {
      if (signal.reason === 'use' && ready) {
        // Acceptance is local. A network failure cancelling optional refinement
        // must never prevent the operator from using the plan already delivered.
        finishRequest(scope);
        return ready;
      }
      if (signal.reason === 'cancel') {
        await cancel(id);
        finishRequest(scope);
      }
      return null;
    }
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      finishRequest(scope);
      throw error;
    }
    if (ready) {
      finishRequest(scope);
      return ready;
    }
    if (error instanceof ApiError && [400, 404, 409].includes(error.status))
      finishRequest(scope);
    throw error;
  }
}
async function cancel(id: string) {
  try {
    await api(`/allocations/planning-jobs/${id}`, noContent, {
      method: 'DELETE',
    });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 750);
    signal.addEventListener('abort', abort, { once: true });
  });
}
