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
  createManufacturerSchema,
  updateManufacturerSchema,
  manufacturerQuerySchema,
  type CreateManufacturer,
  type UpdateManufacturer,
  type ManufacturerQuery,
} from '@roller-bay/shared/fabric-catalog';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { ManufacturersService } from './manufacturers.service.js';

@Controller('fabric-catalog/manufacturers')
export class ManufacturersController {
  constructor(private readonly service: ManufacturersService) {}
  @Get()
  list(
    @Query(new ZodValidationPipe(manufacturerQuerySchema))
    query: ManufacturerQuery,
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
    @Body(new ZodValidationPipe(createManufacturerSchema))
    input: CreateManufacturer,
  ) {
    return this.service.create(input);
  }
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateManufacturerSchema))
    input: UpdateManufacturer,
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
