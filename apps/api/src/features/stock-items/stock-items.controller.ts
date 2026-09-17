import type { Request } from 'express';
import {
  stockCorrectionSchema,
  stockVoidSchema,
  correctionKeySchema,
  type StockCorrection,
} from '@roller-bay/shared/corrections';
import {
  Body,
  Controller,
  Headers,
  Req,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  createStockItemSchema,
  stockItemQuerySchema,
  type CreateStockItem,
  type StockItemQuery,
} from '@roller-bay/shared/stock-items';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { StockItemsService } from './stock-items.service.js';

@Controller('stock-items')
export class StockItemsController {
  constructor(private readonly service: StockItemsService) {}
  @Get()
  list(
    @Query(new ZodValidationPipe(stockItemQuerySchema))
    query: StockItemQuery,
  ) {
    return this.service.list(query);
  }
  @Get(':id')
  findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findById(id);
  }
  @Post()
  @Roles('admin')
  create(
    @Body(new ZodValidationPipe(createStockItemSchema))
    input: CreateStockItem,
    @Req() request: Request,
  ) {
    return this.service.create(input, request.currentUser!.id);
  }
  @Post(':id/corrections')
  @Roles('admin')
  @HttpCode(200)
  correct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(stockCorrectionSchema)) input: StockCorrection,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.service.correct(
      id,
      input,
      request.currentUser!.id,
      new ZodValidationPipe(correctionKeySchema).transform(key),
    );
  }
  @Post(':id/void')
  @Roles('admin')
  @HttpCode(200)
  void(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(stockVoidSchema))
    input: { reason: string; expectedRevision: number },
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.service.void(
      id,
      input,
      request.currentUser!.id,
      new ZodValidationPipe(correctionKeySchema).transform(key),
    );
  }
}
