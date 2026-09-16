import {
  Module,
  type DynamicModule,
  type FactoryProvider,
  type ModuleMetadata,
} from '@nestjs/common';
import { SolverClient, type SolverClientOptions } from './solver.client.js';

@Module({})
export class SolverModule {
  static registerAsync(
    options: Pick<
      FactoryProvider<SolverClientOptions | null>,
      'inject' | 'useFactory'
    > &
      Pick<ModuleMetadata, 'imports'>,
  ): DynamicModule {
    return {
      module: SolverModule,
      imports: options.imports,
      providers: [
        {
          provide: SolverClient,
          inject: options.inject,
          useFactory: async (...dependencies: unknown[]) => {
            const config = await options.useFactory(...dependencies);
            return config ? new SolverClient(config) : null;
          },
        },
      ],
      exports: [SolverClient],
    };
  }

  static register(options: SolverClientOptions): DynamicModule {
    return {
      module: SolverModule,
      providers: [
        {
          provide: SolverClient,
          useFactory: () => new SolverClient(options),
        },
      ],
      exports: [SolverClient],
    };
  }
}
