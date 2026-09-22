import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  employeeInputSchema,
  employeeUpdateSchema,
  type EmployeeInput,
  type EmployeeUpdate,
} from '@roller-bay/shared/employees';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { EmployeesService } from './employees.service.js';
@Controller('employees')
@Roles('admin')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}
  @Get() list() {
    return this.service.list();
  }
  @Post() create(
    @Body(new ZodValidationPipe(employeeInputSchema)) input: EmployeeInput,
    @Req() req: Request,
  ) {
    return this.service.create(input, req.currentUser!.id);
  }
  @Put(':id') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(employeeUpdateSchema)) input: EmployeeUpdate,
    @Req() req: Request,
  ) {
    return this.service.update(id, input, req.currentUser!.id);
  }
}
