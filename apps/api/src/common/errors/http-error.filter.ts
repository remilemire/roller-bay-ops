import {
  Catch,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { logServerFault } from './log-server-fault.js';
import { translateError } from './translate-error.js';

/**
 * Last line of defence for API error responses. Feature code converts driver,
 * provider, and domain failures into HttpExceptions with curated messages;
 * this filter guarantees that nothing else reaches the browser and records the
 * cause chain of every server fault instead.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const { status, body } = translateError(exception);
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    logServerFault(this.logger, http.getRequest<Request>(), status, exception);
    // A handler that already started writing (a @Res() redirect, streaming)
    // cannot receive a JSON body; end the response rather than corrupt it.
    if (response.headersSent) {
      response.end();
      return;
    }
    response.status(status).json(body);
  }
}
