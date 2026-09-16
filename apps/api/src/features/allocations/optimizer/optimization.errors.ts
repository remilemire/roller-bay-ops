export class CuttingOptimizationError extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'invalid_options'
      | 'cancelled'
      | 'numeric_range'
      | 'invalid_solution'
      | 'invalid_model',
    message: string,
  ) {
    super(message);
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
