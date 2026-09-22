import type { UnitOfWorkContext } from '../unit-of-work/unit-of-work-context.js';
import type { UnitOfWork } from '../unit-of-work/unit-of-work.js';

/** Service-test wiring only: commit, rollback and isolation need PostgreSQL tests. */
export function stubUnitOfWork(repositories: {
  [K in keyof UnitOfWorkContext]?: {
    [M in keyof UnitOfWorkContext[K]]?: UnitOfWorkContext[K][M] extends (
      ...args: infer A
    ) => infer R
      ? (...args: A) => R | Promise<Awaited<R>>
      : UnitOfWorkContext[K][M];
  };
}): UnitOfWork {
  const run = <T>(operation: (context: UnitOfWorkContext) => Promise<T>) =>
    operation(repositories as UnitOfWorkContext);
  return { transaction: run, readOnlyTransaction: run } as UnitOfWork;
}
