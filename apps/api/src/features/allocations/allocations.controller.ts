import {
  completionCorrectionSchema,
  correctionKeySchema,
  type CompletionCorrection,
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
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  allocationIdempotencyKeySchema,
  allocationQuerySchema,
  cancelAllocationSchema,
  allocationCancellationSchema,
  type AllocationCancellation,
  completeAllocationRequestSchema,
  createAllocationSchema,
  createAllocationDraftSchema,
  updateAllocationDraftSchema,
  allocationDraftRevisionSchema,
  type AllocationDraftInput,
  optimizeAllocationSchema,
  replaceAllocationSchema,
  validateAllocationSchema,
  type AllocationQuery,
  type CompleteAllocationRequest,
  type CreateAllocation,
  type OptimizeAllocation,
  type ReplaceAllocation,
  type ValidateAllocation,
} from '@roller-bay/shared/allocations';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AllocationsService } from './allocations.service.js';
import { AllocationPlanningService } from './allocation-planning.service.js';
import { CompletionCorrectionsService } from './completion-corrections.service.js';

@Controller('allocations')
export class AllocationsController {
  constructor(
    private readonly service: AllocationsService,
    private readonly planning: AllocationPlanningService,
    private readonly corrections: CompletionCorrectionsService,
  ) {}

  @Post('drafts')
  createDraft(
    @Body(new ZodValidationPipe(createAllocationDraftSchema))
    input: { data: AllocationDraftInput },
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
  ) {
    if (!request.currentUser) throw new UnauthorizedException();
    const validatedKey = new ZodValidationPipe(
      allocationIdempotencyKeySchema,
    ).transform(key);
    return this.service.createDraft(
      input.data,
      request.currentUser.id,
      validatedKey,
    );
  }

  @Put(':id/draft')
  updateDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateAllocationDraftSchema))
    input: { expectedRevision: number; data: AllocationDraftInput },
  ) {
    return this.service.updateDraft(id, input.expectedRevision, input.data);
  }

  @Delete(':id/draft')
  @HttpCode(204)
  deleteDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(allocationDraftRevisionSchema))
    input: { expectedRevision: number },
  ) {
    return this.service.deleteDraft(id, input.expectedRevision);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submitDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(allocationDraftRevisionSchema))
    input: { expectedRevision: number },
    @Req() request: Request,
  ) {
    if (!request.currentUser) throw new UnauthorizedException();
    return this.service.submitDraft(
      id,
      input.expectedRevision,
      request.currentUser!.id,
    );
  }

  @Get(':id/correction-context')
  @Roles('admin')
  correctionContext(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.corrections.context(id);
  }
  @Post(':id/completion-corrections')
  @Roles('admin')
  @HttpCode(200)
  correction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(completionCorrectionSchema))
    input: CompletionCorrection,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.corrections.correct(
      id,
      input,
      request.currentUser!.id,
      new ZodValidationPipe(correctionKeySchema).transform(key),
    );
  }

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
    @Req() request: Request,
  ) {
    return this.service.replace(id, input, request.currentUser!.id);
  }
  @Get(':id/cancellation-context')
  @Roles('admin')
  cancellationContext(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.cancellationContext(id);
  }
  @Post(':id/cancellation')
  @Roles('admin')
  @HttpCode(200)
  cancelReviewed(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(allocationCancellationSchema))
    input: AllocationCancellation,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.service.cancelReviewed(
      id,
      input,
      request.currentUser!.id,
      new ZodValidationPipe(correctionKeySchema).transform(key),
    );
  }
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(cancelAllocationSchema))
    input: { expectedRevision: number },
    @Req() request: Request,
  ) {
    return this.service.cancel(
      id,
      input.expectedRevision,
      request.currentUser!.id,
    );
  }
  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(completeAllocationRequestSchema))
    input: CompleteAllocationRequest,
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
