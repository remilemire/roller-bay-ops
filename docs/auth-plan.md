# Microsoft authentication implementation plan

Status: backend implementation complete. Redis sessions replace the earlier PostgreSQL session-store proposal. Frontend login screens remain a separate step. See [authentication setup](authentication.md) for configuration, tests, and current limits. Live Microsoft sign-in awaits tenant/app credentials.

## Access and identity

- Microsoft OpenID Connect is the only login method. Use one configured Entra tenant and one allowed work sign-in domain, supplied through environment variables.
- Use authorization code flow with PKCE, state, and nonce. Use a maintained OIDC library (`openid-client`) with explicit ID-token signature, issuer, audience, tenant, expiry, and nonce validation. Never trust a decoded token without validation.
- Fetch Microsoft Graph `/me?$select=id,displayName,userPrincipalName,mail,userType` with delegated `User.Read`. Cross-check Graph `id` against the validated token's `oid`, require `userType=Member`, and reject guests and personal-account identities. Directory membership is the initial employee eligibility rule; the tenant administrator must maintain it accordingly.
- Compare the complete domain of Graph `userPrincipalName` with the configured allowed domain, case-insensitively. Reject malformed values, missing values, subdomains, and suffix lookalikes. This is an additional organization policy after tenant and identity validation; an email-looking string alone never grants access.
- Identify the app user by the validated OIDC `sub`, stored in the existing `microsoft_subject_id` column. It is scoped to the configured issuer and client. Keep that configuration fixed; changing the tenant or app registration requires an explicit identity transition. Do not put Graph `oid` into a column named subject ID.
- Automatically create eligible new users with role `user`. The explicit `BOOTSTRAP_OWNER_EMAIL` configuration grants the matching active Microsoft profile ownership only when no owner exists; all other logins preserve roles and history. This does not link identities by email or replace an existing owner. PostgreSQL enforces at most one owner.

Microsoft documents that email and usernames are mutable and that `sub` and `oid` serve as stable identity claims. See the [ID token claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference). The [Graph user resource](https://learn.microsoft.com/en-us/graph/api/resources/user?view=graph-rest-1.0) distinguishes `mail` from `userPrincipalName`; request the needed fields explicitly with [Get user](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0).

## Email handling

Treat `users.email` as directory profile information, separate from the work sign-in name used for the domain policy. Read it from Graph `mail`. Do not silently substitute the UPN, `preferred_username`, or an ID-token email claim: a sign-in name does not establish a working mailbox. The profile email may differ from the sign-in name, and its domain does not replace the chosen UPN restriction.

Use one shared Zod email schema to trim surrounding whitespace and lowercase the entire address, then validate its format and the existing 254-character limit. Apply it before every email write or comparison so stored values and API contracts use the same normalized form. Keep the existing case-insensitive unique index as the database safeguard. Preserve dots and plus tags; do not invent provider-specific alias rules. Never truncate an address to make it fit.

On every successful sign-in, look up the Microsoft subject first, then refresh that user's directory name and email. Never look up an email to attach a new Microsoft identity to an existing user. If an updated or newly received email belongs to another subject, reject the login with a generic conflict message and leave both records unchanged. Resolving reassigned addresses is an explicit administrative action, with no automatic transfer of roles or history. Handle simultaneous sign-ins through the database's uniqueness constraints and a subject-based retry, not just a preliminary lookup.

**Confirmed email decision:** keep `users.email` required, with no nullable-email schema change. Missing, blank, or malformed directory email fails sign-in/profile synchronization without changing the existing user. The implementation focus is consistent normalization and validation.

This feature sends no email and adds no password reset, email login, or verification flow. A synchronized directory address is not a claim that this app has verified mailbox delivery. If notifications or user-editable contact addresses are added later, define and verify that contact address separately.

## Redis sessions

Use `express-session` with a compatible `connect-redis` version and the existing `RedisService.client`. Auth owns session middleware and behavior; `src/redis` continues to own only connection lifecycle. Do not add a PostgreSQL sessions table or `connect-pg-simple`.

- Store sessions under an app-specific Redis prefix, with an opaque, signed session-ID cookie. Store only the internal user ID and authentication/expiry timestamps after login. Read the current user and role from PostgreSQL for protected requests.
- Set `AUTH_SESSION_TTL_SECONDS=604800` by default: seven days of absolute lifetime. Set `rolling:false`, `resave:false`, and `saveUninitialized:false`. Configure `disableTouch:true` and derive Redis TTL from a fixed `expiresAt`; enforce that same deadline in the guard, including after a session is saved again. Ordinary activity must not extend login indefinitely.
- Give temporary OAuth transactions a separate short expiry (ten minutes). Bind state, nonce, and PKCE verifier to the initiating browser session and consume the transaction atomically once. Regenerate the session ID after successful login and save the authenticated session before redirecting.
- Configure the cookie as HttpOnly, SameSite=Lax, host-only, and Secure in production. Use a fixed configured callback URL and frontend destination; do not accept arbitrary return URLs. Configure proxy trust narrowly for a known deployment topology.
- Logout uses POST, destroys the Redis session, and clears the cookie using matching attributes. It signs out of this app; it does not promise to sign out of Microsoft globally.
- Redis read/write failures deny protected access with a service-unavailable response. Do not fall back to an in-memory store or report successful login/logout before the relevant Redis operation succeeds.
- Discard Microsoft tokens after validation and the Graph profile request. Do not request offline access or put Microsoft access/refresh tokens in browser storage, application sessions, or logs.

The Redis adapter documents expiry and touch behavior in [connect-redis](https://github.com/tj/connect-redis). Verify compatibility with the installed Redis client before selecting the adapter version.

## Backend boundaries and routes

`features/auth` owns OAuth orchestration, sessions, guards, and auth routes. `features/users` owns persistence, profile synchronization, activation, role management, and ownership transfer. Shared Zod contracts expose the authenticated user's public profile and existing shared role enum; never expose Microsoft tokens, subjects, or session secrets.

Inside auth, `sessions/` and `oauth-transactions/` are sibling Nest modules. Each provides a service backed by its own repository, and neither imports the other. `SessionsRepository` owns the Express session-store adapter and Redis session TTLs; `OAuthTransactionsRepository` owns transaction key construction, serialization, expiry, and atomic consumption. The services own their lifecycle rules and map storage failures to generic errors. The auth controller coordinates anonymous browser-session creation, transaction storage, and authenticated session creation.

| Route                    | Behavior                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/login`    | Begin Microsoft sign-in.                                                                                                    |
| `GET /api/auth/callback` | Validate and consume the OAuth transaction, enforce eligibility, synchronize the user, establish the session, and redirect. |
| `GET /api/auth/me`       | Return the current user or 401.                                                                                             |
| `POST /api/auth/logout`  | Destroy the current app session and clear its cookie.                                                                       |

Use a global session guard. Explicitly mark login, callback, and process liveness public; protect current-user and future business endpoints. Allow credentialed CORS only from `WEB_ORIGIN`. Require that exact Origin for state-changing browser requests, including logout; reject missing/untrusted origins. GET business routes must not mutate business state. OAuth callback uses its dedicated state/nonce/PKCE protections.

Configuration includes `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_CALLBACK_URL`, `AUTH_ALLOWED_DOMAIN`, `AUTH_SESSION_SECRET`, and `AUTH_SESSION_TTL_SECONDS`, alongside `REDIS_URL` and `WEB_ORIGIN`. Validate configuration on startup and document the single-tenant Entra registration and delegated permission setup. Actual tenant, domain, and credentials are still needed for a live sign-in test.

## Validation and limits

Test rejected tenant/domain/guest identities, invalid signatures and claims, mismatched Graph identity, replayed or expired OAuth transactions, and session fixation. Test profile synchronization, rejection of missing/blank/malformed emails, normalization of surrounding whitespace and case, preservation of dots and plus tags, reassigned addresses, uniqueness races, and preservation of existing roles. Test cookies, Origin checks, logout, absolute expiry after session writes, and Redis outages/reconnects against real Redis. Use provider fixtures for automated tests and report live Microsoft sign-in separately.

Directory profile and eligibility checks happen at sign-in. An Entra account change or disablement does not automatically revoke an already issued local session; it can last until logout or the seven-day deadline. Local deactivation denies access on the next protected request. Loading the app user on every request also makes local user deletion and role changes take effect immediately.

Implemented: shared email normalization and auth contracts, user synchronization, Redis session integration, Microsoft callback flow, route protection, and automated tests. The migration history is reset to a single initial users migration; authentication requires no additional PostgreSQL tables.
