import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  updateUserActivationSchema,
  type UpdateUserActivation,
} from '@roller-bay/shared/users';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch(':id/activation')
  @Roles('admin')
  setActivation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateUserActivationSchema))
    input: UpdateUserActivation,
  ) {
    return this.users.setActivation(id, input.isActive);
  }
}
