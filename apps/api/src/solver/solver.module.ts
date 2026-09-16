import { Module, type DynamicModule } from '@nestjs/common';
import { SolverClient, type SolverClientOptions } from './solver.client.js';

@Module({})
export class SolverModule {
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
