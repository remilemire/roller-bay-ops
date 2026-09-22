import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  locationQuerySchema,
  type LocationQuery,
} from '@roller-bay/shared/locations';
import { LocationLevelsService } from '../locations/levels/location-levels.service.js';
import type { z } from 'zod';
import type { Request } from 'express';
import {
  completionInputSchema,
  worksheetSaveSchema,
  worksheetSubmitSchema,
  worksheetReviewSchema,
  worksheetReturnSchema,
  type WorksheetSave,
  type WorksheetSubmit,
} from '@roller-bay/shared/production';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CuttingWorksheetsService } from '../allocations/cutting-worksheets.service.js';
import { requireStation } from './production-access.js';
@Controller('production/cutting')
@Roles('station')
export class CuttingStationController {
  constructor(
    private readonly service: CuttingWorksheetsService,
    private readonly locations: LocationLevelsService,
  ) {}
  @Get('locations') locationsList(
    @Query(new ZodValidationPipe(locationQuerySchema)) query: LocationQuery,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!, 'cutting');
    return this.locations.list(query);
  }
  @Get('worksheets') @Roles('admin') list() {
    return this.service.list();
  }
  @Get('orders/:id/worksheet') forOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!, 'cutting');
    return this.service.findForOrder(id);
  }
  @Post('orders/:id/worksheet') begin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(completionInputSchema))
    body: { employeeId: string },
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!, 'cutting');
    return this.service.begin(id, body.employeeId, req.currentUser!.id);
  }
  @Get('worksheets/:id') get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!, 'cutting');
    return this.service.find(id);
  }
  @Put('worksheets/:id/draft') save(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(worksheetSaveSchema)) body: WorksheetSave,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!, 'cutting');
    return this.service.save(id, body);
  }
  @Post('worksheets/:id/submit') submit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(worksheetSubmitSchema)) body: WorksheetSubmit,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!, 'cutting');
    return this.service.submit(id, body, req.currentUser!.id);
  }
  @Post('worksheets/:id/review') @Roles('admin') review(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(worksheetReviewSchema))
    body: z.infer<typeof worksheetReviewSchema>,
    @Req() req: Request,
  ) {
    return this.service.review(
      id,
      body.expectedRevision,
      req.currentUser!.id,
      body.resolution,
    );
  }
  @Post('worksheets/:id/return') @Roles('admin') returnForCorrection(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(worksheetReturnSchema))
    body: { expectedRevision: number; reason: string },
    @Req() req: Request,
  ) {
    return this.service.returnForCorrection(
      id,
      body.expectedRevision,
      body.reason,
      req.currentUser!.id,
    );
  }
  @Post('worksheets/:id/abandon') @Roles('admin') abandon(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(worksheetReturnSchema))
    body: { expectedRevision: number; reason: string },
    @Req() req: Request,
  ) {
    return this.service.abandon(
      id,
      body.expectedRevision,
      body.reason,
      req.currentUser!.id,
    );
  }
}
