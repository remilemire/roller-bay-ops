/** App-agnostic HTTP client; validates wire models and responses, never launches Python. */
import type { OnModuleDestroy } from '@nestjs/common';
import {
  solverModelSchema,
  solveOptionsSchema,
  type SolverModel,
  type SolveResult,
  type SolveOptions,
} from './solver.contracts.js';
import { SolverError } from './solver.errors.js';
import { parseSolverResult } from './solver.response.js';
import { sendSolveRequest } from './http-transport.js';

export interface SolverClientOptions {
  baseUrl: string;
  apiKey: string;
}

export class SolverClient implements OnModuleDestroy {
  private readonly url: URL;
  private readonly apiKey: string;
  private readonly pending = new Map<AbortController, Promise<string>>();
  private closed = false;

  constructor(options: SolverClientOptions) {
    const url = new URL(options.baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('Solver base URL must be an HTTP(S) origin.');
    if (options.apiKey.length < 32)
      throw new Error('Solver API key must contain at least 32 characters.');
    this.url = new URL('/v1/solve', url);
    this.apiKey = options.apiKey;
  }

  async solve(
    modelInput: SolverModel,
    options: SolveOptions = {},
  ): Promise<SolveResult> {
    if (this.closed)
      throw new SolverError('closed', 'Solver client is closed.');
    const model = solverModelSchema.safeParse(modelInput);
    if (!model.success)
      throw new SolverError('invalid_model', model.error.message);
    const { signal, ...solverOptions } = options;
    const parsedOptions = solveOptionsSchema.safeParse(solverOptions);
    if (
      !parsedOptions.success ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    )
      throw new SolverError('invalid_options', 'Invalid solver options.');
    if (signal?.aborted) throw new SolverError('cancelled', 'Solve cancelled.');
    const input = JSON.stringify({
      model: model.data,
      options: parsedOptions.data,
    });
    if (Buffer.byteLength(input) > 4 * 1024 * 1024)
      throw new SolverError(
        'invalid_model',
        'Model exceeds the 4 MiB request limit.',
      );
    const controller = new AbortController();
    let timedOut = false;
    // Allow process startup and transport time beyond the solver's own search budget.
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.ceil(parsedOptions.data.maxTimeSeconds * 1000) + 35000,
    );
    const completion = sendSolveRequest({
      url: this.url,
      apiKey: this.apiKey,
      input,
      signal: signal
        ? AbortSignal.any([controller.signal, signal])
        : controller.signal,
    });
    this.pending.set(controller, completion);
    try {
      return parseSolverResult(await completion, model.data);
    } catch (error) {
      if (timedOut)
        throw new SolverError('timeout', 'Solver request timed out.');
      if (controller.signal.aborted || signal?.aborted)
        throw new SolverError('cancelled', 'Solve cancelled.');
      if (error instanceof SolverError) throw error;
      throw new SolverError(
        'unavailable',
        'Could not reach the Solver service.',
      );
    } finally {
      clearTimeout(timer);
      this.pending.delete(controller);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    const pending = [...this.pending];
    for (const [controller] of pending) controller.abort();
    await Promise.allSettled(pending.map(([, completion]) => completion));
  }
}
