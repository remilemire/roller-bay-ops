import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createScheduledOrderSchema,
  deleteScheduledOrderSchema,
  scheduledOrderQuerySchema,
  updateScheduledOrderSchema,
  type CreateScheduledOrder,
  type DeleteScheduledOrder,
  type ScheduledOrderQuery,
  type UpdateScheduledOrder,
} from '@roller-bay/shared/order-schedule';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { OrderScheduleService } from './order-schedule.service.js';

@Controller('order-schedule')
export class OrderScheduleController {
  constructor(private readonly service: OrderScheduleService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(scheduledOrderQuerySchema))
    query: ScheduledOrderQuery,
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
    @Body(new ZodValidationPipe(createScheduledOrderSchema))
    input: CreateScheduledOrder,
    @Req() request: Request,
  ) {
    return this.service.create(input, request.currentUser!.id);
  }

  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateScheduledOrderSchema))
    input: UpdateScheduledOrder,
    @Req() request: Request,
  ) {
    return this.service.update(id, input, request.currentUser!.id);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(deleteScheduledOrderSchema))
    input: DeleteScheduledOrder,
    @Req() request: Request,
  ) {
    return this.service.delete(
      id,
      input.expectedRevision,
      request.currentUser!.id,
    );
  }
}
