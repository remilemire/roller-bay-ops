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
  createLocationZoneSchema,
  updateLocationZoneSchema,
  locationZoneQuerySchema,
  type CreateLocationZone,
  type UpdateLocationZone,
  type LocationZoneQuery,
} from '@roller-bay/shared/locations';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { LocationZonesService } from './location-zones.service.js';

@Controller('locations/zones')
export class LocationZonesController {
  constructor(private readonly service: LocationZonesService) {}
  @Get()
  list(
    @Query(new ZodValidationPipe(locationZoneQuerySchema))
    query: LocationZoneQuery,
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
    @Body(new ZodValidationPipe(createLocationZoneSchema))
    input: CreateLocationZone,
  ) {
    return this.service.create(input);
  }
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateLocationZoneSchema))
    input: UpdateLocationZone,
  ) {
    return this.service.update(id, input);
  }
  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  delete(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.delete(id);
  }
}
