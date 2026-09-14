import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { emailSchema } from '@roller-bay/shared/users';
import type { Environment } from '../../config/environment.js';
import { microsoftProfileSchema } from '../users/microsoft-profile.schema.js';
import type { OAuthTransaction } from './oauth-transactions/oauth-transaction.schema.js';

const identitySchema = z.object({
  sub: z.string().min(1),
  tid: z.uuid(),
  oid: z.uuid(),
  idp: z.string().optional(),
});
const directorySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  userPrincipalName: emailSchema,
  mail: emailSchema,
  userType: z.literal('Member'),
});
const PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

export function microsoftProfile(
  claims: unknown,
  directory: unknown,
  tenant: string,
  domain: string,
) {
  const identity = identitySchema.safeParse(claims);
  const user = directorySchema.safeParse(directory);
  if (
    !identity.success ||
    !user.success ||
    identity.data.tid.toLowerCase() !== tenant.toLowerCase() ||
    identity.data.oid.toLowerCase() !== user.data.id.toLowerCase() ||
    identity.data.idp === 'live.com' ||
    identity.data.idp?.includes(PERSONAL_TENANT) ||
    user.data.userPrincipalName.split('@')[1] !== domain
  ) {
    throw new UnauthorizedException(
      'This Microsoft account is not eligible to sign in.',
    );
  }
  const profile = microsoftProfileSchema.safeParse({
    microsoftSubjectId: identity.data.sub,
    name: user.data.displayName,
    email: user.data.mail,
  });
  if (!profile.success)
    throw new UnauthorizedException(
      'The Microsoft directory profile is incomplete or invalid.',
    );
  return profile.data;
}

@Injectable()
export class MicrosoftService {
  private configuration?: Promise<oidc.Configuration>;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  private getConfiguration() {
    if (!this.configuration) {
      const tenant = this.config.get('MICROSOFT_TENANT_ID', { infer: true });
      this.configuration = oidc
        .discovery(
          new URL(`https://login.microsoftonline.com/${tenant}/v2.0`),
          this.config.get('MICROSOFT_CLIENT_ID', { infer: true }),
          this.config.get('MICROSOFT_CLIENT_SECRET', { infer: true }),
          undefined,
          { timeout: 10, execute: [oidc.enableNonRepudiationChecks] },
        )
        .catch(() => {
          this.configuration = undefined;
          throw new ServiceUnavailableException(
            'Microsoft sign-in is unavailable.',
          );
        });
    }
    return this.configuration;
  }

  async begin() {
    const config = await this.getConfiguration();
    const transaction = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      verifier: oidc.randomPKCECodeVerifier(),
    };
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.config.get('MICROSOFT_CALLBACK_URL', { infer: true }),
      scope: 'openid profile User.Read',
      response_mode: 'query',
      code_challenge: await oidc.calculatePKCECodeChallenge(
        transaction.verifier,
      ),
      code_challenge_method: 'S256',
      state: transaction.state,
      nonce: transaction.nonce,
    });
    return { url: url.href, transaction };
  }

  async complete(url: URL, transaction: OAuthTransaction) {
    const config = await this.getConfiguration();
    let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
    try {
      tokens = await oidc.authorizationCodeGrant(config, url, {
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        pkceCodeVerifier: transaction.verifier,
        idTokenExpected: true,
      });
    } catch {
      // Never log provider errors: they can contain codes, tokens, or profiles.
      throw new UnauthorizedException('Microsoft sign-in failed. Start again.');
    }
    let directory: unknown;
    try {
      const response = await fetch(
        'https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail,userType',
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('Directory request failed.');
      directory = await response.json();
    } catch {
      throw new ServiceUnavailableException(
        'Microsoft directory is unavailable.',
      );
    }
    return microsoftProfile(
      tokens.claims(),
      directory,
      this.config.get('MICROSOFT_TENANT_ID', { infer: true }),
      this.config.get('AUTH_ALLOWED_DOMAIN', { infer: true }),
    );
  }
}
