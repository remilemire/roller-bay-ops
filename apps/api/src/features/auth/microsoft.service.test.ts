import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, after, test, mock } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { MicrosoftService, microsoftProfile } from './microsoft.service.js';
import { environmentSchema } from '../../config/environment.js';
import { emailSchema } from '@roller-bay/shared/users';

const tenant = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const oid = '33333333-3333-4333-8333-333333333333';
const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
const claims = { sub: 'stable-subject', oid, tid: tenant };
const directory = {
  id: oid,
  displayName: '  Test User  ',
  userPrincipalName: 'Employee@Example.COM',
  mail: '  Person.Name+ops@Example.COM  ',
  userType: 'Member',
};
const settings = {
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6380',
  MICROSOFT_TENANT_ID: tenant,
  MICROSOFT_CLIENT_ID: clientId,
  MICROSOFT_CLIENT_SECRET: 'test-secret',
  MICROSOFT_CALLBACK_URL: 'http://localhost:3001/api/auth/callback',
  AUTH_ALLOWED_DOMAIN: 'example.com',
  AUTH_SESSION_SECRET: 'test-secret-that-is-at-least-32-characters',
};

test('email normalization is consistent and preserves dots and tags', () => {
  assert.equal(
    emailSchema.parse(directory.mail),
    'person.name+ops@example.com',
  );
  for (const input of [
    '',
    '   ',
    'bad email@example.com',
    'missing-at',
    null,
    'a'.repeat(250) + '@example.com',
  ])
    assert.equal(emailSchema.safeParse(input).success, false);
  assert.deepEqual(microsoftProfile(claims, directory, tenant, 'example.com'), {
    microsoftSubjectId: 'stable-subject',
    name: 'Test User',
    email: 'person.name+ops@example.com',
  });
  assert.equal(
    microsoftProfile(
      claims,
      { ...directory, mail: 'profile@different.example' },
      tenant,
      'example.com',
    ).email,
    'profile@different.example',
  );
});

test('directory policy rejects wrong tenant, guests, personal identities, mismatched objects, and domain lookalikes', () => {
  for (const invalid of [
    { ...claims, tid: clientId },
    { ...claims, oid: clientId },
    { ...claims, idp: 'live.com' },
    { ...claims, sub: '' },
  ])
    assert.throws(() =>
      microsoftProfile(invalid, directory, tenant, 'example.com'),
    );
  for (const invalid of [
    { ...directory, userType: 'Guest' },
    { ...directory, userType: null },
    ...[
      'person@sub.example.com',
      'person@notexample.com',
      'person@example.com.attacker.com',
      '',
      'invalid',
    ].map((userPrincipalName) => ({ ...directory, userPrincipalName })),
    ...[null, '', ' ', 'broken'].map((mail) => ({ ...directory, mail })),
  ])
    assert.throws(() =>
      microsoftProfile(claims, invalid, tenant, 'example.com'),
    );
});

test('auth configuration requires explicit credentials and rejects unsafe URLs and proxy trust', () => {
  assert.equal(
    environmentSchema.parse(settings).AUTH_SESSION_TTL_SECONDS,
    604800,
  );
  assert.equal(
    environmentSchema.parse({
      ...settings,
      AUTH_ALLOWED_DOMAIN: ' Example.COM ',
    }).AUTH_ALLOWED_DOMAIN,
    'example.com',
  );
  for (const override of [
    { AUTH_SESSION_SECRET: 'short' },
    { AUTH_ALLOWED_DOMAIN: '*.example.com' },
    { MICROSOFT_TENANT_ID: 'common' },
    { WEB_ORIGIN: 'http://attacker.com' },
    { WEB_ORIGIN: 'http://localhost:3000/path' },
    { MICROSOFT_CALLBACK_URL: 'http://localhost:3001/wrong' },
    { NODE_ENV: 'production' },
    { TRUSTED_PROXY_IPS: 'true' },
    { AUTH_SESSION_TTL_SECONDS: 0 },
  ])
    assert.equal(
      environmentSchema.safeParse({ ...settings, ...override }).success,
      false,
    );
});

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKey: Awaited<ReturnType<typeof generateKeyPair>>;
let tokenClaims: Record<string, unknown> = {};
let badSignature = false;
let expectedVerifier = '';
let graphStatus = 200;
let calls = 0;

before(async () => {
  signingKey = await generateKeyPair('RS256');
  otherKey = await generateKeyPair('RS256');
  const jwk = {
    ...(await exportJWK(signingKey.publicKey)),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
  };
  mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/.well-known/openid-configuration'))
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/keys`,
          response_types_supported: ['code'],
          subject_types_supported: ['pairwise'],
          id_token_signing_alg_values_supported: ['RS256'],
        });
      if (url === `${issuer}/keys`) return Response.json({ keys: [jwk] });
      if (url === `${issuer}/token`) {
        calls++;
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get('code_verifier'), expectedVerifier);
        assert.equal(body.get('redirect_uri'), settings.MICROSOFT_CALLBACK_URL);
        const token = await new SignJWT({ ...claims, ...tokenClaims })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuedAt()
          .sign(badSignature ? otherKey.privateKey : signingKey.privateKey);
        return Response.json({
          access_token: 'test-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: token,
        });
      }
      if (url.startsWith('https://graph.microsoft.com/v1.0/me?'))
        return Response.json(directory, { status: graphStatus });
      throw new Error(`Unexpected provider URL: ${url}`);
    },
  );
});

after(() => mock.restoreAll());

async function login(overrides: Record<string, unknown> = {}) {
  badSignature = false;
  graphStatus = 200;
  const service = new MicrosoftService(
    new ConfigService(environmentSchema.parse(settings)),
  );
  const { url, transaction } = await service.begin();
  const authorization = new URL(url);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    authorization.searchParams.get('scope'),
    'openid profile User.Read',
  );
  expectedVerifier = transaction.verifier;
  tokenClaims = {
    iss: issuer,
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: transaction.nonce,
    ...overrides,
  };
  const callback = new URL(settings.MICROSOFT_CALLBACK_URL);
  callback.searchParams.set('code', 'test-code');
  callback.searchParams.set('state', transaction.state);
  return {
    service,
    callback,
    transaction: { ...transaction, expiresAt: Date.now() + 600000 },
  };
}

test('real OIDC library validates a signed provider response and sends PKCE', async () => {
  const { service, callback, transaction } = await login();
  assert.equal(
    (await service.complete(callback, transaction)).email,
    'person.name+ops@example.com',
  );
});

test('real OIDC library rejects invalid signature, issuer, audience, expiry, nonce, and state', async () => {
  for (const overrides of [
    { iss: 'https://attacker.example' },
    { aud: oid },
    { exp: 1 },
    { nonce: 'wrong' },
    {},
  ]) {
    const { service, callback, transaction } = await login(overrides);
    if (Object.keys(overrides).length === 0) badSignature = true;
    await assert.rejects(
      service.complete(callback, transaction),
      /Microsoft sign-in failed/,
    );
  }
  const { service, callback, transaction } = await login();
  callback.searchParams.set('state', 'wrong');
  const beforeCalls = calls;
  await assert.rejects(
    service.complete(callback, transaction),
    /Microsoft sign-in failed/,
  );
  assert.equal(calls, beforeCalls);
});

test('directory outages do not produce a user profile', async () => {
  const { service, callback, transaction } = await login();
  graphStatus = 503;
  await assert.rejects(
    service.complete(callback, transaction),
    /directory is unavailable/,
  );
});

test('bootstrap owner email uses the same normalization as user emails', () => {
  assert.equal(
    environmentSchema.parse({
      ...settings,
      BOOTSTRAP_OWNER_EMAIL: ' Owner@Example.COM ',
    }).BOOTSTRAP_OWNER_EMAIL,
    'owner@example.com',
  );
  assert.equal(
    environmentSchema.parse({ ...settings, BOOTSTRAP_OWNER_EMAIL: '   ' })
      .BOOTSTRAP_OWNER_EMAIL,
    undefined,
  );
  assert.equal(
    environmentSchema.safeParse({
      ...settings,
      BOOTSTRAP_OWNER_EMAIL: 'invalid',
    }).success,
    false,
  );
});
