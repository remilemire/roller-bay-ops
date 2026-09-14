# Authentication setup

The Nest API supports Microsoft work-account sign-in only. Users must belong to the configured tenant, have directory type `Member`, and have a work sign-in name in the configured domain. New users receive role `user`; subsequent logins preserve their role and history. Administrators must keep Entra membership appropriate for employee access.

The backend is implemented and tested. The frontend login screen is not yet implemented, and the demo notes UI does not yet send session credentials. Live Microsoft authentication requires your app registration and has not yet been exercised.

## Microsoft registration

1. In Microsoft Entra, register an application for **accounts in this organizational directory only**. Copy its Directory (tenant) ID and Application (client) ID.
2. Add a **Web** redirect URI of `http://localhost:3001/api/auth/callback` for local development. The backend handles the code exchange; do not register this as a SPA callback or enable implicit token grants.
3. Create a client secret and copy its **value** into the ignored API environment file. The secret ID is not the secret value. Track its expiry and replace it before it expires.
4. Configure the delegated Microsoft Graph `User.Read` permission. Consent must be allowed by your tenant, or granted by its administrator. The login requests `openid profile User.Read`; it does not request offline access or store Microsoft tokens.

References: [register an application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [Microsoft Graph Get user](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0).

## Environment

Complete `apps/api/.env` using the fields in `.env.example`:

| Variable                   | Meaning                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MICROSOFT_TENANT_ID`      | Directory tenant UUID; `common` and `organizations` are not allowed.                                                                 |
| `MICROSOFT_CLIENT_ID`      | Application client UUID.                                                                                                             |
| `MICROSOFT_CLIENT_SECRET`  | Client secret value; backend only.                                                                                                   |
| `MICROSOFT_CALLBACK_URL`   | Exact registered callback URL ending in `/api/auth/callback`.                                                                        |
| `AUTH_ALLOWED_DOMAIN`      | Employee sign-in domain, without `@`; exact match after lowercasing.                                                                 |
| `AUTH_SESSION_SECRET`      | Strong random cookie-signing secret, at least 32 characters. Keep it consistent across API instances.                                |
| `AUTH_SESSION_TTL_SECONDS` | Absolute session lifetime; default `604800` (seven days), allowed range 60 seconds to 30 days. Changes affect newly issued sessions. |
| `REDIS_URL`                | Session store, locally `redis://localhost:6380`.                                                                                     |
| `WEB_ORIGIN`               | Exact frontend origin allowed for credentialed CORS, mutation requests, and the post-login redirect.                                 |
| `TRUSTED_PROXY_IPS`        | Optional comma-separated proxy IPs/CIDRs. Empty trusts no proxy. Configure only the actual reverse proxy addresses.                  |

Generate a cookie-signing secret locally, then paste it into `AUTH_SESSION_SECRET`:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Do not put these backend settings in `NEXT_PUBLIC_` variables. API startup rejects missing settings. Discovery of Microsoft's endpoints happens on login, so startup does not require Microsoft to be reachable. Existing local environment files are preserved; add the new fields to yours.

Run `npm run services:up`, apply the database migrations with `npm run db:migrate`, then start the applications. Auth adds no PostgreSQL session table; it uses the existing users table and Redis.

## Routes and browser integration

Navigate the browser to `http://localhost:3001/api/auth/login` to start login. Microsoft returns to the configured callback; after validation, the API redirects to `WEB_ORIGIN`. Failures return a generic HTTP error without provider tokens or profile details. There is no arbitrary return-URL parameter.

`GET /api/auth/me` returns `{ id, name, role, email, createdAt }`. `POST /api/auth/logout` deletes the app session and clears the cookie, returning 204. It does not sign out the user's Microsoft account globally. Browser calls to these and business endpoints need `credentials: 'include'`. Mutations also require the exact configured `Origin`; a manual HTTP client must provide that header. `/api/health` is public process liveness, even if Redis is unavailable.

Session cookies are HttpOnly, host-only, and SameSite=Lax. Production adds Secure and uses the `__Host-roller_bay.sid` name. Deploy frontend and API on the same site with HTTPS; an unrelated frontend domain will not work with this cookie policy. If TLS ends at a proxy, set the trusted proxy addresses so Express can recognize HTTPS. Never trust arbitrary forwarded headers.

## Email and user identity

Emails are required. The shared `emailSchema` trims surrounding whitespace, lowercases the complete address, and validates format and length (254 characters). Dots and plus tags remain intact. All user synchronization uses this schema; PostgreSQL additionally enforces case-insensitive email uniqueness.

The directory's `mail` supplies profile email. Missing/blank/invalid email denies login; the app does not fabricate one from a sign-in name. The domain check uses the directory's `userPrincipalName`, which can differ from its mailbox address. Microsoft subject ID identifies the user, so email changes update the same account. If another subject already has that email, synchronization fails atomically; an administrator must resolve the conflict. No account linking or role transfer occurs by email.

## Tests

`npm test` runs provider fixtures, configuration and email checks, and the notes controller tests. The OIDC tests use the real validation library with generated RSA-signed tokens; they reject invalid signatures, issuers, audiences, expiry, nonce, and state.

Run the real-service auth suite against local services after migrations:

```sh
TEST_DATABASE_URL=postgresql://roller_bay:roller_bay_local@localhost:5434/roller_bay_ops \
TEST_REDIS_URL=redis://localhost:6380 \
npm run test:integration
```

This suite creates a randomly named PostgreSQL schema containing copies of the migrated users/notes table structures, then removes that schema. It creates and deletes only its own random Redis session/transaction keys. It covers browser binding, concurrent callback replay, session ID rotation, expiry after resaves, profile updates and conflicts, concurrent first login, role preservation, Origin checks, logout, Redis outage recovery, and local user deletion. It does not use real Microsoft credentials.

## Current limits

Directory eligibility and profile data refresh at sign-in. Disabling an Entra account does not instantly revoke an existing local session: it can last until logout or its absolute expiry. Immediate offboarding requires a session revocation or revalidation feature. Local user deletion and role updates take effect on the next protected request. Role-specific business permissions are not implemented yet.

Keep the tenant and client registration stable: the stored Microsoft subject is scoped to them. Changing registrations requires an explicit identity transition. Redis session data is required for access; there is no memory fallback during an outage.
