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
  orderWorkflowSchema,
  type OrderWorkflow,
} from '@roller-bay/shared/work-orders';
import { correctionKeySchema } from '@roller-bay/shared/corrections';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { WorkOrderWorkflowsService } from './work-order-workflows.service.js';
@Controller('work-orders')
@Roles('admin')
export class WorkOrderWorkflowsController {
  constructor(private readonly service: WorkOrderWorkflowsService) {}
  @Get(':id/cancellation-context')
  context(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.context(id);
  }
  @Post(':id/cancellation')
  @HttpCode(200)
  execute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(orderWorkflowSchema)) input: OrderWorkflow,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.service.execute(
      id,
      input,
      request.currentUser!.id,
      new ZodValidationPipe(correctionKeySchema).transform(key),
    );
  }
}
