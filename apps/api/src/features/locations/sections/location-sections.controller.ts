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
  createLocationSectionSchema,
  updateLocationSectionSchema,
  locationSectionQuerySchema,
  type CreateLocationSection,
  type UpdateLocationSection,
  type LocationSectionQuery,
} from '@roller-bay/shared/locations';
import { LocationOrderService } from '../location-order.service.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { LocationSectionsService } from './location-sections.service.js';

@Controller('locations/sections')
export class LocationSectionsController {
  constructor(
    private readonly service: LocationSectionsService,
    private readonly ordering: LocationOrderService,
  ) {}
  @Get()
  list(
    @Query(new ZodValidationPipe(locationSectionQuerySchema))
    query: LocationSectionQuery,
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
    @Body(new ZodValidationPipe(createLocationSectionSchema))
    input: CreateLocationSection,
  ) {
    return this.service.create(input);
  }
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateLocationSectionSchema))
    input: UpdateLocationSection,
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
    return this.ordering.move('sections', id, input);
  }
  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  delete(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.delete(id);
  }
}
