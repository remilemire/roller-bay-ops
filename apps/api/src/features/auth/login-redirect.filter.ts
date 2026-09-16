import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { LoginErrorCode } from '@roller-bay/shared/auth';
import { logServerFault } from '../../common/errors/log-server-fault.js';
import type { Environment } from '../../config/environment.js';
import { MicrosoftAccountNotEligibleException } from './microsoft.errors.js';

/** Browser login routes return safe error codes; ordinary API routes keep HTTP errors. */
@Catch()
export class LoginRedirectFilter implements ExceptionFilter {
  private readonly logger = new Logger(LoginRedirectFilter.name);

  constructor(private readonly config: ConfigService<Environment, true>) {}

  catch(error: unknown, host: ArgumentsHost) {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const http = host.switchToHttp();
    // This filter replaces the global one on login routes, so it records
    // server faults itself.
    logServerFault(this.logger, http.getRequest<Request>(), status, error);
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
    const response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.redirect(destination.href);
  }
}
