import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  orderCancellationSchema,
  type OrderCancellation,
} from '@roller-bay/shared/work-orders';
import { correctionKeySchema } from '@roller-bay/shared/corrections';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { WorkOrderCancellationService } from './work-order-cancellation.service.js';
@Controller('work-orders')
@Roles('admin')
export class WorkOrderCancellationController {
  constructor(private readonly service: WorkOrderCancellationService) {}
  @Get(':id/cancellation-context')
  context(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.context(id);
  }
  @Post(':id/cancellation')
  @HttpCode(200)
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(orderCancellationSchema))
    input: OrderCancellation,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.service.cancel(
      id,
      input,
      request.currentUser!.id,
      new ZodValidationPipe(correctionKeySchema).transform(key),
    );
  }
}
