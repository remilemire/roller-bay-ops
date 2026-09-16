export type SolverErrorCode =
  | 'invalid_model'
  | 'invalid_options'
  | 'busy'
  | 'unavailable'
  | 'timeout'
  | 'cancelled'
  | 'protocol_error'
  | 'closed';

export class SolverError extends Error {
  constructor(
    readonly code: SolverErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SolverError';
  }
}
