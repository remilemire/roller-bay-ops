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
} from '@nestjs/common';
import {
  moveLocationSchema,
  type MoveLocation,
  createLocationSchema,
  updateLocationSchema,
  locationQuerySchema,
  type CreateLocation,
  type UpdateLocation,
  type LocationQuery,
} from '@roller-bay/shared/locations';
import { LocationOrderService } from '../location-order.service.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { LocationLevelsService } from './location-levels.service.js';

@Controller('locations')
export class LocationLevelsController {
  constructor(
    private readonly service: LocationLevelsService,
    private readonly ordering: LocationOrderService,
  ) {}
  @Get()
  list(
    @Query(new ZodValidationPipe(locationQuerySchema))
    query: LocationQuery,
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
    @Body(new ZodValidationPipe(createLocationSchema))
    input: CreateLocation,
  ) {
    return this.service.create(input);
  }
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateLocationSchema))
    input: UpdateLocation,
  ) {
    return this.service.update(id, input);
  }
  @Post(':id/move')
  @Roles('admin')
  @HttpCode(204)
  move(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(moveLocationSchema)) input: MoveLocation,
  ) {
    return this.ordering.move('levels', id, input);
  }
  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  delete(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.delete(id);
  }
}
