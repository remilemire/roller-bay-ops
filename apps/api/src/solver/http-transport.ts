/** Bounded HTTP transport. The solver service owns processes and execution capacity. */
import { SolverError } from './solver.errors.js';

export interface SolveHttpRequest {
  url: URL;
  apiKey: string;
  input: string;
  signal: AbortSignal;
}

export async function sendSolveRequest(
  request: SolveHttpRequest,
): Promise<string> {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${request.apiKey}`,
    },
    body: request.input,
    signal: request.signal,
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 409)
      throw new SolverError('busy', 'Solver service is busy.');
    if (response.status === 422 || response.status === 413)
      throw new SolverError(
        'invalid_model',
        'Solver service rejected the model.',
      );
    if (response.status === 504)
      throw new SolverError(
        'timeout',
        'Solver service exceeded its execution deadline.',
      );
    throw new SolverError(
      'unavailable',
      'Solver service is unavailable or rejected authentication.',
    );
  }
  if (!response.body)
    throw new SolverError('protocol_error', 'Empty Solver response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 4 * 1024 * 1024)
        throw new SolverError(
          'protocol_error',
          'Solver response exceeds its size limit.',
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}
