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
  createLocationSectionSchema,
  updateLocationSectionSchema,
  locationSectionQuerySchema,
  type CreateLocationSection,
  type UpdateLocationSection,
  type LocationSectionQuery,
} from '@roller-bay/shared/locations';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { LocationSectionsService } from './location-sections.service.js';

@Controller('locations/sections')
export class LocationSectionsController {
  constructor(private readonly service: LocationSectionsService) {}
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
  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  delete(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.delete(id);
  }
}
