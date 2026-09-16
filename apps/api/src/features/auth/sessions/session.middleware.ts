import {
  Injectable,
  ServiceUnavailableException,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SessionsService } from './sessions.service.js';

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly sessions: SessionsService) {}

  use(request: Request, response: Response, next: NextFunction) {
    this.sessions.middleware(request, response, (error?: unknown) => {
      next(
        error
          ? new ServiceUnavailableException('Session storage is unavailable.', {
              cause: error,
            })
          : undefined,
      );
    });
  }
}
