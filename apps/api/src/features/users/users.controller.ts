import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  updateMeasurementUnitsSchema,
  type UpdateMeasurementUnits,
  updateUserActivationSchema,
  type UpdateUserActivation,
  updateUserRoleSchema,
  type UpdateUserRole,
  transferOwnershipSchema,
  type TransferOwnership,
} from '@roller-bay/shared/users';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Any active user may change their own units; the target is never a path id.
  @Patch('me/measurement-units')
  setMeasurementUnits(
    @Req() request: Request,
    @Body(new ZodValidationPipe(updateMeasurementUnitsSchema))
    input: UpdateMeasurementUnits,
  ) {
    return this.users.setMeasurementUnits(request.currentUser!.id, input);
  }

  @Patch(':id/activation')
  @Roles('admin')
  setActivation(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateUserActivationSchema))
    input: UpdateUserActivation,
  ) {
    return this.users.setActivation(
      request.currentUser!.id,
      id,
      input.isActive,
    );
  }

  @Patch(':id/role')
  @Roles('admin')
  setRole(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateUserRoleSchema)) input: UpdateUserRole,
  ) {
    return this.users.setRole(request.currentUser!.id, id, input.role);
  }

  @Post('transfer-ownership')
  @Roles('owner')
  @HttpCode(200)
  transferOwnership(
    @Req() request: Request,
    @Body(new ZodValidationPipe(transferOwnershipSchema))
    input: TransferOwnership,
  ) {
    return this.users.transferOwnership(
      request.currentUser!.id,
      input.newOwnerId,
    );
  }
}
