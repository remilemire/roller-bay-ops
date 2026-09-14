import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RateLimitingService } from './rate-limiting.service.js';

@Injectable()
export class ApiRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly limits: RateLimitingService) {}

  use(request: Request, response: Response, next: NextFunction) {
    this.limits.api(request, response, next);
  }
}

@Injectable()
export class LoginRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly limits: RateLimitingService) {}

  use(request: Request, response: Response, next: NextFunction) {
    this.limits.login(request, response, next);
  }
}
