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
  createLocationSchema,
  updateLocationSchema,
  locationQuerySchema,
  type CreateLocation,
  type UpdateLocation,
  type LocationQuery,
} from '@roller-bay/shared/locations';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { LocationLevelsService } from './location-levels.service.js';

@Controller('locations')
export class LocationLevelsController {
  constructor(private readonly service: LocationLevelsService) {}
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
  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  delete(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.delete(id);
  }
}
