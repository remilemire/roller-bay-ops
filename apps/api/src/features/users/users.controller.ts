import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  updateColorThemeSchema,
  type UpdateColorTheme,
  updateMeasurementUnitsSchema,
  type UpdateMeasurementUnits,
  updateUserActivationSchema,
  type UpdateUserActivation,
  updateUserRoleSchema,
  type UpdateUserRole,
  transferOwnershipSchema,
  type TransferOwnership,
  userQuerySchema,
  type UserQuery,
} from '@roller-bay/shared/users';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('admin')
  list(@Query(new ZodValidationPipe(userQuerySchema)) query: UserQuery) {
    return this.users.list(query);
  }

  // Any active user may change their own preferences; the target is never a
  // path id.
  @Roles('production')
  @Patch('me/measurement-units')
  setMeasurementUnits(
    @Req() request: Request,
    @Body(new ZodValidationPipe(updateMeasurementUnitsSchema))
    input: UpdateMeasurementUnits,
  ) {
    return this.users.setMeasurementUnits(request.currentUser!.id, input);
  }

  @Roles('production')
  @Patch('me/color-theme')
  setColorTheme(
    @Req() request: Request,
    @Body(new ZodValidationPipe(updateColorThemeSchema))
    input: UpdateColorTheme,
  ) {
    return this.users.setColorTheme(request.currentUser!.id, input.colorTheme);
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
    return this.users.setRole(
      request.currentUser!.id,
      id,
      input.role,
      input.stations,
    );
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
