import type { DatabaseService } from './database.service.js';

/** Query capabilities shared by a pool and a transaction; repositories cannot start transactions. */
export type DatabaseExecutor = Pick<
  DatabaseService['db'],
  'select' | 'selectDistinct' | 'insert' | 'update' | 'delete' | 'execute'
>;
