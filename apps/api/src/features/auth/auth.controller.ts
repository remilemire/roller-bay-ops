import {
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { currentUserSchema } from '@roller-bay/shared/auth';
import { Public } from '../../common/decorators/public.decorator.js';
import type { Environment } from '../../config/environment.js';
import { UsersService } from '../users/users.service.js';
import { MicrosoftService } from './microsoft.service.js';
import { SessionsService } from './sessions.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly microsoft: MicrosoftService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  @Public()
  @Get('login')
  async login(@Req() request: Request, @Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    const { url, transaction } = await this.microsoft.begin();
    await this.sessions.begin(request, transaction);
    response.redirect(url);
  }

  @Public()
  @Get('callback')
  async callback(@Req() request: Request, @Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    // Use configured redirect URI, never the untrusted Host/proxy headers.
    const url = new URL(
      this.config.get('MICROSOFT_CALLBACK_URL', { infer: true }),
    );
    url.search = new URL(request.originalUrl, 'http://internal').search;
    const states = url.searchParams.getAll('state');
    if (states.length !== 1 || !states[0])
      throw new UnauthorizedException('Invalid sign-in response.');
    const transaction = await this.sessions.consume(request, states[0]);
    const profile = await this.microsoft.complete(url, transaction);
    const user = await this.users.synchronizeMicrosoftProfile(profile);
    await this.sessions.authenticate(request, user.id);
    response.redirect(this.config.get('WEB_ORIGIN', { infer: true }));
  }

  @Get('me')
  me(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return currentUserSchema.parse(request.currentUser);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    await this.sessions.logout(request, response);
  }
}
