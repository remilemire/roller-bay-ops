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
  createFabricMaterialSchema,
  updateFabricMaterialSchema,
  fabricMaterialQuerySchema,
  type CreateFabricMaterial,
  type UpdateFabricMaterial,
  type FabricMaterialQuery,
} from '@roller-bay/shared/fabric-catalog';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { FabricMaterialsService } from './fabric-materials.service.js';

@Controller('fabric-catalog/materials')
export class FabricMaterialsController {
  constructor(private readonly service: FabricMaterialsService) {}
  @Get()
  list(
    @Query(new ZodValidationPipe(fabricMaterialQuerySchema))
    query: FabricMaterialQuery,
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
    @Body(new ZodValidationPipe(createFabricMaterialSchema))
    input: CreateFabricMaterial,
  ) {
    return this.service.create(input);
  }
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateFabricMaterialSchema))
    input: UpdateFabricMaterial,
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
