import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { historyQuerySchema } from '@roller-bay/shared/audit';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuditService } from './audit.service.js';
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get('stock-items/:id/history')
  stock(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(historyQuerySchema))
    query: { page: number; pageSize: number },
  ) {
    return this.audit.history('stock-items', id, query);
  }
  @Get('stock-receipts/:id/history')
  receipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(historyQuerySchema))
    query: { page: number; pageSize: number },
  ) {
    return this.audit.history('stock-receipts', id, query);
  }
  @Get('allocations/:id/history')
  allocation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(historyQuerySchema))
    query: { page: number; pageSize: number },
  ) {
    return this.audit.history('allocations', id, query);
  }
  @Get('work-orders/:id/history')
  order(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(historyQuerySchema))
    query: { page: number; pageSize: number },
  ) {
    return this.audit.history('work-orders', id, query);
  }
}
