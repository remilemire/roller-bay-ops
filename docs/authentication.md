# Authentication setup

The Nest API supports Microsoft work-account sign-in only. Users must belong to the configured tenant, have directory type `Member`, and have a work sign-in name in the configured domain. New users are active and normally receive role `user`. The configured bootstrap email can become the initial owner when no owner exists; otherwise sign-in preserves role, activation status, and history. Administrators must keep Entra membership appropriate for employee access.

The backend is implemented and tested. The frontend is a placeholder; the login screen and credentialed API calls are not yet implemented. Live Microsoft authentication requires your app registration and has not yet been exercised.

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
| `BOOTSTRAP_OWNER_EMAIL`    | Initial owner's Microsoft profile email, normalized like stored emails. Blank disables bootstrap.                                    |
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

`GET /api/auth/me` returns `{ id, name, role, isActive, email, createdAt }`. `POST /api/auth/logout` deletes the app session and clears the cookie, returning 204. It does not sign out the user's Microsoft account globally. Browser calls to these and business endpoints need `credentials: 'include'`. Mutations also require the exact configured `Origin`; a manual HTTP client must provide that header. `/api/health` is public process liveness, even if Redis is unavailable.

Session cookies are HttpOnly, host-only, and SameSite=Lax. Production adds Secure and uses the `__Host-roller_bay.sid` name. Deploy frontend and API on the same site with HTTPS; an unrelated frontend domain will not work with this cookie policy. If TLS ends at a proxy, set the trusted proxy addresses so Express can recognize HTTPS. Never trust arbitrary forwarded headers.

## User activation

Admins and the owner can call `PATCH /api/users/:id/activation` with `{ "isActive": false }` to deactivate an existing user, or `{ "isActive": true }` to reactivate them. The request requires a valid active admin session and the configured Origin header. Regular users cannot change activation. The owner cannot be deactivated, including by the owner themselves. The body accepts only a boolean `isActive`; the endpoint cannot change roles or profile fields.

A successful update returns 200 with the public user profile, including `isActive`. Repeating the current state also succeeds. Invalid input returns 400, missing users return 404, and unauthorized roles return 403.

Deactivated users receive 403 when completing Microsoft sign-in, before an authenticated session is created. Signing in never changes their activation status. The global guard also checks activation on every protected request, so existing sessions lose access on their next request. Logout remains available. Reactivation permits sign-in again; an existing unexpired session can also resume because the activation check is live, rather than permanent session revocation.

The `0002_add_user_activation.sql` migration adds `is_active boolean NOT NULL DEFAULT true`, preserving access for existing users. Apply pending migrations before running the updated backend.

## Roles and ownership

Roles form a hierarchy: `owner` inherits all `admin` permissions, and both inherit `user` access. Current database roles are checked on each protected request. User-management operations check the acting user again inside the database transaction, so an earlier guard result cannot authorize a stale role.

| Endpoint                             | Allowed callers    | Behavior                                               |
| ------------------------------------ | ------------------ | ------------------------------------------------------ |
| `PATCH /api/users/:id/role`          | Admin or owner     | Set a non-owner's role to user or admin.               |
| `POST /api/users/transfer-ownership` | Current owner only | Transfer ownership to `newOwnerId` from the JSON body. |

Role updates accept `{ "role": "admin" }` or `{ "role": "user" }` and return 200 with the public user. The body must contain only `role`; assigning `owner` through this endpoint is rejected with 400. Repeating the current role succeeds. Admins can change other admins and themselves, but this endpoint cannot target the owner. Role updates do not activate a disabled user. Ordinary users receive 403; malformed UUIDs or invalid bodies receive 400 and missing targets receive 404. All mutations require the configured Origin header.

Ownership transfer accepts `{ "newOwnerId": "<user UUID>" }` and returns `{ previousOwner, newOwner }` with both public user records. The recipient must be an existing active user or admin. Transferring to yourself or an inactive user returns 409; a missing recipient returns 404. The previous owner becomes an admin. Both updates commit atomically, and failure rolls both back. Concurrent transfers by the same owner have only one winner; the other request receives 403 after its owner permission is rechecked.

The `users_single_owner_unique` partial unique index allows at most one `role = 'owner'` row, including for direct SQL writes. It allows zero owners before bootstrap. User-management transactions serialize writes to the users table while checking permissions and changing roles, so transfers and bootstrap cannot observe a temporary owner vacancy. Ordinary reads remain available. Waiting to acquire a lock is limited to five seconds; a timeout rolls back and returns 503.

`UsersRepository.withLockedTransaction` supplies an instance of the same repository bound to the transaction connection. Normal reads and transactional operations share one set of query methods. Services call that boundary explicitly, keep authorization and ownership rules inside its callback, and translate storage failures in ordinary catch blocks. There is no separate management-transaction repository interface.

### Bootstrap the first owner

Set `BOOTSTRAP_OWNER_EMAIL` in `apps/api/.env` to the intended owner's Microsoft profile email before they sign in. Matching uses the same trimmed, lowercase email from Graph `mail` that the application stores, not the Microsoft sign-in name. Normal tenant, membership, domain, and active-account checks still apply.

If no owner exists, the matching active user's first successful sign-in after configuration grants ownership. Nonmatching users remain ordinary users. Concurrent matching sign-ins produce the same single owner. Bootstrap never activates an inactive user, links identities by email, replaces an existing owner, or takes ownership back after a transfer. You can clear the variable after setup; leaving it set has no effect while an owner exists. It is not an ownership recovery or transfer mechanism.

The `0003_single_owner.sql` migration creates the database index. Existing multiple-owner data must be resolved explicitly before that migration can succeed.

## Email and user identity

Emails are required. The shared `emailSchema` trims surrounding whitespace, lowercases the complete address, and validates format and length (254 characters). Dots and plus tags remain intact. All user synchronization uses this schema; PostgreSQL additionally enforces case-insensitive email uniqueness.

The directory's `mail` supplies profile email. Missing/blank/invalid email denies login; the app does not fabricate one from a sign-in name. The domain check uses the directory's `userPrincipalName`, which can differ from its mailbox address. Microsoft subject ID identifies the user, so email changes update the same account. If another subject already has that email, synchronization fails atomically; an administrator must resolve the conflict. No account linking or role transfer occurs by email.

## Module boundaries

`features/auth/sessions/` owns browser-session creation, cookies, authentication, and logout. Its repository owns the Redis-backed Express session store and absolute expiry. Anonymous sessions have a generic expiry and contain no OAuth state, nonce, or PKCE verifier.

`features/auth/oauth-transactions/` is a sibling module that owns those short-lived login transactions. Its service enforces the ten-minute lifetime and validates consumed transactions. Its repository owns Redis keys and serialization, binds records to the browser session ID, and uses atomic `GETDEL` so a transaction can only be consumed once.

Neither module imports the other. The auth controller coordinates them; services use repositories rather than issuing Redis commands. The session repository exposes the established Express session-store interface instead of introducing a duplicate CRUD interface.

## Tests

`npm test` runs provider fixtures, configuration and email checks, and user persistence error tests. The OIDC tests use the real validation library with generated RSA-signed tokens; they reject invalid signatures, issuers, audiences, expiry, nonce, and state.

Run the real-service auth suite against local services after applying pending migrations:

```sh
TEST_DATABASE_URL=postgresql://roller_bay:roller_bay_local@localhost:5434/roller_bay_ops \
TEST_REDIS_URL=redis://localhost:6380 \
npm run test:integration
```

This suite creates a randomly named PostgreSQL schema and copies the migrated application table structures, including catalog foreign keys, into it. It removes that schema afterward. Tests require the application database to be migrated first and do not execute migration files. It creates and deletes only its own random Redis session/transaction keys. It covers browser binding, concurrent callback replay, session ID rotation, expiry after resaves, profile updates and conflicts, concurrent first login, role preservation, activation permissions, blocked sign-in and existing-session access for inactive users, reactivation, owner bootstrap, database owner uniqueness, role-management permissions, concurrent ownership transfer, service-level rollback after a simulated recipient-update failure, and lock timeout recovery, Origin checks, logout, Redis outage recovery, and local user deletion. It does not use real Microsoft credentials.

## Current limits

Directory eligibility and profile data refresh at sign-in. Disabling an Entra account does not instantly revoke an existing local session: it can last until logout or its absolute expiry. An admin can deactivate the local user to deny access on the next protected request. Local user deletion and role updates also take effect on the next protected request. Protected endpoints enforce the user/admin/owner hierarchy.

Keep the tenant and client registration stable: the stored Microsoft subject is scoped to them. Changing registrations requires an explicit identity transition. Redis session data is required for access; there is no memory fallback during an outage.

Catalog reads allow all active signed-in roles; admins and the owner can write. The global guard checks role metadata after loading the current user. See [catalog API permissions](fabric-catalog.md).
