import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createStockReceiptSchema,
  idempotencyKeySchema,
  stockReceiptQuerySchema,
  type CreateStockReceipt,
  type StockReceiptQuery,
} from '@roller-bay/shared/stock-receipts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { StockReceiptsService } from './stock-receipts.service.js';

@Controller('stock-receipts')
export class StockReceiptsController {
  constructor(private readonly service: StockReceiptsService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(createStockReceiptSchema))
    input: CreateStockReceipt,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
  ) {
    if (!request.currentUser) throw new UnauthorizedException();
    const validatedKey = new ZodValidationPipe(idempotencyKeySchema).transform(
      key,
    );
    return this.service.create(input, request.currentUser.id, validatedKey);
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(stockReceiptQuerySchema))
    query: StockReceiptQuery,
  ) {
    return this.service.list(query);
  }

  @Get(':id')
  findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findById(id);
  }
}
