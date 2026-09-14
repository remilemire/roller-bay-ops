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
  createFabricColorSchema,
  updateFabricColorSchema,
  fabricColorQuerySchema,
  type CreateFabricColor,
  type UpdateFabricColor,
  type FabricColorQuery,
} from '@roller-bay/shared/fabric-catalog';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { FabricColorsService } from './fabric-colors.service.js';

@Controller('fabric-catalog/colors')
export class FabricColorsController {
  constructor(private readonly service: FabricColorsService) {}
  @Get()
  list(
    @Query(new ZodValidationPipe(fabricColorQuerySchema))
    query: FabricColorQuery,
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
    @Body(new ZodValidationPipe(createFabricColorSchema))
    input: CreateFabricColor,
  ) {
    return this.service.create(input);
  }
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateFabricColorSchema))
    input: UpdateFabricColor,
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
