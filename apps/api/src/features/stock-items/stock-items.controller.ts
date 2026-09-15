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
  createStockItemSchema,
  updateStockItemSchema,
  stockItemQuerySchema,
  type CreateStockItem,
  type UpdateStockItem,
  type StockItemQuery,
} from '@roller-bay/shared/stock-items';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { StockItemsService } from './stock-items.service.js';

@Controller('stock-items')
export class StockItemsController {
  constructor(private readonly service: StockItemsService) {}
  @Get()
  list(
    @Query(new ZodValidationPipe(stockItemQuerySchema))
    query: StockItemQuery,
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
    @Body(new ZodValidationPipe(createStockItemSchema))
    input: CreateStockItem,
  ) {
    return this.service.create(input);
  }
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateStockItemSchema))
    input: UpdateStockItem,
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
