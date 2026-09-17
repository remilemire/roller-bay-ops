import {
  receiptCorrectionSchema,
  correctionKeySchema,
  type ReceiptCorrection,
} from '@roller-bay/shared/corrections';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  Body,
  Delete,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createStockReceiptSchema,
  createStockReceiptDraftSchema,
  updateStockReceiptDraftSchema,
  stockReceiptDraftRevisionSchema,
  type StockReceiptDraftData,
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

  @Post('drafts')
  createDraft(
    @Body(new ZodValidationPipe(createStockReceiptDraftSchema))
    input: { data: StockReceiptDraftData },
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
  ) {
    if (!request.currentUser) throw new UnauthorizedException();
    const validatedKey = new ZodValidationPipe(idempotencyKeySchema).transform(
      key,
    );
    return this.service.createDraft(
      input.data,
      request.currentUser.id,
      validatedKey,
    );
  }

  @Put(':id/draft')
  updateDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateStockReceiptDraftSchema))
    input: { expectedRevision: number; data: StockReceiptDraftData },
    @Req() request: Request,
  ) {
    return this.service.updateDraft(
      id,
      input.expectedRevision,
      input.data,
      request.currentUser!.id,
    );
  }

  @Delete(':id/draft')
  @HttpCode(204)
  deleteDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(stockReceiptDraftRevisionSchema))
    input: { expectedRevision: number },
    @Req() request: Request,
  ) {
    return this.service.deleteDraft(
      id,
      input.expectedRevision,
      request.currentUser!.id,
    );
  }

  @Post(':id/submit')
  @HttpCode(200)
  submitDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(stockReceiptDraftRevisionSchema))
    input: { expectedRevision: number },
    @Req() request: Request,
  ) {
    if (!request.currentUser) throw new UnauthorizedException();
    return this.service.submitDraft(
      id,
      input.expectedRevision,
      request.currentUser.id,
    );
  }

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

  @Get(':id/correction-context')
  @Roles('admin')
  correctionContext(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.correctionContext(id);
  }
  @Post(':id/corrections')
  @Roles('admin')
  @HttpCode(200)
  correction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(receiptCorrectionSchema))
    input: ReceiptCorrection,
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
