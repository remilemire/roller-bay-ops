import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { LoginErrorCode } from '@roller-bay/shared/auth';
import type { Environment } from '../../config/environment.js';
import { MicrosoftAccountNotEligibleException } from './microsoft.errors.js';

/** Browser login routes return safe error codes; ordinary API routes keep HTTP errors. */
@Catch()
export class LoginRedirectFilter implements ExceptionFilter {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  catch(error: unknown, host: ArgumentsHost) {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const code: LoginErrorCode =
      error instanceof MicrosoftAccountNotEligibleException
        ? 'account_not_eligible'
        : status === 401
          ? 'sign_in_failed'
          : status === 403
            ? 'account_inactive'
            : status === 409
              ? 'account_conflict'
              : 'unavailable';
    // Never forward exception text, provider parameters, or a caller-supplied destination.
    const destination = new URL(
      '/login',
      this.config.get('WEB_ORIGIN', { infer: true }),
    );
    destination.searchParams.set('error', code);
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.redirect(destination.href);
  }
}
