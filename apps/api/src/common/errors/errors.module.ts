import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HttpErrorFilter } from './http-error.filter.js';

/**
 * Registers the response translator globally. AppModule and every test harness
 * that boots an HTTP application import it, so integration suites exercise the
 * same error path as production.
 */
@Module({ providers: [{ provide: APP_FILTER, useClass: HttpErrorFilter }] })
export class ErrorsModule {}
