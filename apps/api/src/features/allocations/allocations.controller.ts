import {
  Body,
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
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  allocationIdempotencyKeySchema,
  allocationQuerySchema,
  cancelAllocationSchema,
  completeAllocationSchema,
  createAllocationSchema,
  optimizeAllocationSchema,
  replaceAllocationSchema,
  validateAllocationSchema,
  type AllocationQuery,
  type CompleteAllocation,
  type CreateAllocation,
  type OptimizeAllocation,
  type ReplaceAllocation,
  type ValidateAllocation,
} from '@roller-bay/shared/allocations';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AllocationsService } from './allocations.service.js';
import { AllocationPlanningService } from './allocation-planning.service.js';

@Controller('allocations')
export class AllocationsController {
  constructor(
    private readonly service: AllocationsService,
    private readonly planning: AllocationPlanningService,
  ) {}
  @Get()
  list(
    @Query(new ZodValidationPipe(allocationQuerySchema)) query: AllocationQuery,
  ) {
    return this.service.list(query);
  }
  @Get(':id')
  findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findById(id);
  }

  @Post('optimize')
  @HttpCode(200)
  async optimize(
    @Body(new ZodValidationPipe(optimizeAllocationSchema))
    input: OptimizeAllocation,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const close = () => {
      if (!response.writableEnded) abort();
    };
    request.once('aborted', abort);
    response.once('close', close);
    try {
      return await this.planning.optimize(input, controller.signal);
    } finally {
      request.off('aborted', abort);
      response.off('close', close);
    }
  }
  @Post('validate')
  @HttpCode(200)
  validate(
    @Body(new ZodValidationPipe(validateAllocationSchema))
    input: ValidateAllocation,
  ) {
    return this.planning.validate(input);
  }
  @Post()
  create(
    @Body(new ZodValidationPipe(createAllocationSchema))
    input: CreateAllocation,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
  ) {
    return this.service.create(input, this.userId(request), this.key(key));
  }
  @Put(':id')
  replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(replaceAllocationSchema))
    input: ReplaceAllocation,
  ) {
    return this.service.replace(id, input);
  }
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(cancelAllocationSchema))
    input: { expectedRevision: number },
  ) {
    return this.service.cancel(id, input.expectedRevision);
  }
  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(completeAllocationSchema))
    input: CompleteAllocation,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
  ) {
    return this.service.complete(
      id,
      input,
      this.userId(request),
      this.key(key),
    );
  }

  private userId(request: Request) {
    if (!request.currentUser) throw new UnauthorizedException();
    return request.currentUser.id;
  }
  private key(input: string | undefined) {
    return new ZodValidationPipe(allocationIdempotencyKeySchema).transform(
      input,
    );
  }
}
