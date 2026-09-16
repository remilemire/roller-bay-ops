import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  type ArgumentsHost,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginRedirectFilter } from './login-redirect.filter.js';
import { MicrosoftAccountNotEligibleException } from './microsoft.errors.js';

test('login failures redirect only safe codes to the configured frontend', () => {
  const filter = new LoginRedirectFilter(
    new ConfigService({ WEB_ORIGIN: 'https://ops.example.com' }),
  );
  for (const [error, code] of [
    [new MicrosoftAccountNotEligibleException(), 'account_not_eligible'],
    [new UnauthorizedException('state=private&code=secret'), 'sign_in_failed'],
    [new ForbiddenException('private profile'), 'account_inactive'],
    [new ConflictException('private email'), 'account_conflict'],
    [new ServiceUnavailableException('private connection'), 'unavailable'],
    [new Error('https://attacker.example/?token=secret'), 'unavailable'],
  ] as const) {
    const headers = new Map<string, string>();
    let destination = '';
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
      redirect: (url: string) => {
        destination = url;
      },
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as ArgumentsHost;
    filter.catch(error, host);
    assert.equal(destination, `https://ops.example.com/login?error=${code}`);
    assert.equal(headers.get('Cache-Control'), 'no-store');
    assert.equal(headers.get('Referrer-Policy'), 'no-referrer');
  }
});
