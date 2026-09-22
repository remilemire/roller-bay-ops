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
} from '@nestjs/common';
import type { Request } from 'express';
import {
  completionInputSchema,
  milestoneCorrectionSchema,
  stationQuerySchema,
  type MilestoneCorrection,
  type StationQuery,
} from '@roller-bay/shared/production';
import { stationSchema, type Station } from '@roller-bay/shared/users';
import { correctionKeySchema } from '@roller-bay/shared/corrections';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { EmployeesService } from '../employees/employees.service.js';
import { WorkOrderProductionService } from '../work-orders/work-order-production.service.js';
import { ProductionRepository } from './production.repository.js';
import { requireStation } from './production-access.js';
@Controller('production')
@Roles('station')
export class ProductionController {
  constructor(
    private readonly repository: ProductionRepository,
    private readonly orders: WorkOrderProductionService,
    private readonly employees: EmployeesService,
  ) {}
  @Get('employees') employeesList(@Req() req: Request) {
    requireStation(req.currentUser!);
    return this.employees.list(true);
  }
  @Get('orders/:id/completions') completions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!);
    return this.orders.list(id);
  }
  @Get(':station/orders') list(
    @Param('station', new ZodValidationPipe(stationSchema)) station: Station,
    @Query(new ZodValidationPipe(stationQuerySchema)) query: StationQuery,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!, station);
    return this.repository.list(station, query);
  }
  @Post(':station/orders/:id/complete') complete(
    @Param('station', new ZodValidationPipe(stationSchema)) station: Station,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(completionInputSchema))
    body: { employeeId: string },
    @Headers('idempotency-key') rawKey: string,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!, station);
    return this.orders.complete(
      id,
      station,
      body.employeeId,
      req.currentUser!.id,
      new ZodValidationPipe(correctionKeySchema).transform(rawKey),
    );
  }
  @Post(':station/orders/:id/corrections') @Roles('admin') correct(
    @Param('station', new ZodValidationPipe(stationSchema)) station: Station,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(milestoneCorrectionSchema))
    body: MilestoneCorrection,
    @Headers('idempotency-key') rawKey: string,
    @Req() req: Request,
  ) {
    return this.orders.correct(
      id,
      station,
      body,
      req.currentUser!.id,
      new ZodValidationPipe(correctionKeySchema).transform(rawKey),
    );
  }
}
