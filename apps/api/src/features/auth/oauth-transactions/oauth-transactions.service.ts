import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuthTransactionsRepository } from './oauth-transactions.repository.js';
import {
  oauthTransactionSchema,
  type CreateOAuthTransaction,
} from './oauth-transaction.schema.js';

export const OAUTH_TRANSACTION_TTL_SECONDS = 600;

@Injectable()
export class OAuthTransactionsService {
  constructor(private readonly repository: OAuthTransactionsRepository) {}

  async create(browserSessionId: string, input: CreateOAuthTransaction) {
    const transaction = {
      ...input,
      expiresAt: Date.now() + OAUTH_TRANSACTION_TTL_SECONDS * 1000,
    };
    await this.storage(() =>
      this.repository.create(browserSessionId, transaction),
    );
  }

  async consume(browserSessionId: string, state: string) {
    if (!/^[\w-]{32,128}$/.test(state)) throw this.invalidTransaction();
    const value = await this.storage(() =>
      this.repository.consume(browserSessionId, state),
    );
    const result = oauthTransactionSchema.safeParse(value);
    if (
      !result.success ||
      result.data.expiresAt <= Date.now() ||
      result.data.state !== state
    )
      throw this.invalidTransaction();
    return result.data;
  }

  private invalidTransaction() {
    return new UnauthorizedException(
      'Invalid or expired sign-in. Start again.',
    );
  }

  private async storage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new ServiceUnavailableException(
        'Sign-in transaction storage is unavailable.',
      );
    }
  }
}
