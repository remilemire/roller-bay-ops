import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { DatabaseService } from '../../database/database.service.js';
import { UnitOfWorkModule } from '../../unit-of-work/unit-of-work.module.js';
import { AuditController } from './audit.controller.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';
@Module({
  imports: [UnitOfWorkModule, DatabaseModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    {
      provide: AuditRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new AuditRepository(database.db),
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
