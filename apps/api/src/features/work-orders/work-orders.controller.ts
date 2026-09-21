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
  createWorkOrderSchema,
  deleteWorkOrderSchema,
  workOrderQuerySchema,
  updateWorkOrderSchema,
  type CreateWorkOrder,
  type DeleteWorkOrder,
  type WorkOrderQuery,
  type UpdateWorkOrder,
} from '@roller-bay/shared/work-orders';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { WorkOrdersService } from './work-orders.service.js';

@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly service: WorkOrdersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(workOrderQuerySchema))
    query: WorkOrderQuery,
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
    @Body(new ZodValidationPipe(createWorkOrderSchema))
    input: CreateWorkOrder,
    @Req() request: Request,
  ) {
    return this.service.create(input, request.currentUser!.id);
  }

  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateWorkOrderSchema))
    input: UpdateWorkOrder,
    @Req() request: Request,
  ) {
    return this.service.update(id, input, request.currentUser!.id);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(deleteWorkOrderSchema))
    input: DeleteWorkOrder,
    @Req() request: Request,
  ) {
    return this.service.delete(
      id,
      input.expectedRevision,
      request.currentUser!.id,
    );
  }
}
