/**
 * `invalid_input` and `numeric_range` describe the order and may be shown to
 * the requester. Every other code is an internal fault: the schema or solver
 * detail lives in `cause` for the API log, never in `message`.
 */
export class CuttingOptimizationError extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'invalid_options'
      | 'invalid_context'
      | 'cancelled'
      | 'numeric_range'
      | 'invalid_solution'
      | 'invalid_model',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CuttingOptimizationError';
  }
}

export function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new CuttingOptimizationError(
      'cancelled',
      'Cutting optimization cancelled.',
    );
}
