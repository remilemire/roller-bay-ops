import { ExpressAdapter } from '@nestjs/platform-express';

/**
 * Nest's Express adapter rewrites body-parser SyntaxErrors and path-decoding
 * URIErrors into BadRequestExceptions that quote the offending request bytes,
 * before any filter runs. Passing exceptions through untouched lets
 * HttpErrorFilter translate them like every other Express request error.
 */
export class PassthroughExpressAdapter extends ExpressAdapter {
  override mapException(error: unknown): unknown {
    return error;
  }
}
