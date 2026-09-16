import { hasAnyRole } from '../../common/authorization/roles.js';
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@roller-bay/shared/users';
import { REQUIRED_ROLES } from '../../common/decorators/roles.decorator.js';
import { IS_PUBLIC } from '../../common/decorators/public.decorator.js';
import type { Environment } from '../../config/environment.js';
import { UsersService } from '../users/users.service.js';
import { SessionsService } from './sessions/sessions.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Environment, true>,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    // Check mutations even on public routes: CORS alone does not prevent a
    // foreign page from sending a cookie-authenticated request.
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.get('origin') !== this.config.get('WEB_ORIGIN', { infer: true })
    ) {
      throw new ForbiddenException('Untrusted request origin.');
    }
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    this.sessions.assertAvailable();
    const auth = request.session?.auth;
    if (
      !auth ||
      !Number.isFinite(auth.expiresAt) ||
      auth.expiresAt <= Date.now()
    )
      throw new UnauthorizedException('Sign in required.');
    // Read permissions afresh so deactivation and role changes affect existing sessions.
    const user = await this.users.findById(auth.userId);
    if (!user) throw new UnauthorizedException('Sign in required.');
    if (!user.isActive)
      throw new ForbiddenException('Your account is deactivated.');
    request.currentUser = user;
    const roles = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !hasAnyRole(user.role, roles))
      throw new ForbiddenException('Your role cannot perform this action.');
    return true;
  }
}
