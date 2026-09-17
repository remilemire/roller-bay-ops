# Deployment: Vercel and Render

The frontend runs on Vercel. The Nest API runs as a public Render Node service, and the Python solver runs as a private Render service. PostgreSQL and Redis remain external. No application Dockerfiles, Nginx, or process supervisor are required; Docker Compose remains useful for the local database and Redis.

The browser uses `https://mydomain.com/api/*`. Vercel rewrites those requests to the API's public Render HTTPS address, preserving the `/api` prefix, path, and query string. The solver is reachable only through Render's private network. The API still requires authentication and enforces permissions and Origin checks regardless of how it is reached.

## Vercel frontend

Import this repository as a Next.js project with **Root Directory `apps/web`** and **Node.js 24.x**. Make the workspace files outside that directory available to the build. `apps/web/vercel.json` installs only the web/shared workspaces plus root build tools, then builds shared contracts before Next.js.

Set the Vercel environment variable:

```text
API_ORIGIN=https://YOUR_API_SERVICE.onrender.com
```

Use the actual public API origin, with no `/api` suffix. This is server-side build configuration; it is not a `NEXT_PUBLIC_*` variable. Vercel builds fail if it is missing or is not an HTTPS origin. Rebuild the frontend after changing it.

Leave `NEXT_PUBLIC_API_URL` unset on Vercel (or set it to `/api`). Local development retains the direct `http://localhost:3001/api` override from `.env.example`. Do not copy local environment files into the hosting configuration.

Point the public custom domain to Vercel. External rewrite caching is explicitly disabled for `/api/*`, with private/no-store response headers, because inventory and session responses are private and change frequently. No application proxy route or Vercel function is needed to forward requests.

For staging, use a dedicated frontend domain, staging API and backing services, and a matching Microsoft callback. A random Vercel preview URL is not automatically authorized by the production API's exact Origin policy.

Sources: [Vercel monorepos](https://vercel.com/docs/monorepos), [external rewrites and caching](https://vercel.com/docs/rewrites), [Next.js rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites).

## Render API and solver

Use the root `render.yaml` Blueprint. It defines only the API and solver; provide your PostgreSQL and Redis connection URLs. Keep the API, solver, and backing services in the same Render region. The declared region and compute plan are starting values; size them using measured workloads.

The API builds from the repository root because it depends on `packages/shared`. Render uses Node 24 from `.nvmrc`. The build explicitly installs development tools needed to compile the API and run Drizzle migrations. Its start command converts Render's solver `host:port` reference into `SOLVER_URL` and starts Node directly.

The solver builds from `apps/solver`, installs the pinned `requirements.txt`, and uses Python 3.14 from `.python-version`. Its start command maps Render's `PORT` to the existing `SOLVER_PORT`. Both services listen on `0.0.0.0`; Render owns process restart and shutdown handling. The solver key is shared through a Render service reference.

Supply the API settings from [authentication](authentication.md) and `apps/api/.env.example`. In particular:

| Setting                     | Production value                                       |
| --------------------------- | ------------------------------------------------------ |
| `WEB_ORIGIN`                | `https://mydomain.com` (the Vercel frontend)           |
| `MICROSOFT_CALLBACK_URL`    | `https://mydomain.com/api/auth/callback`               |
| `DATABASE_URL`, `REDIS_URL` | Authenticated production connections                   |
| `AUTH_SESSION_SECRET`       | A stable, private session secret                       |
| `TRUSTED_PROXY_IPS`         | Verified proxy IPs/CIDRs for the deployed request path |

Register the same callback in Microsoft Entra as a **Web** redirect URI. Login begins through the frontend's `/api/auth/login`; the API exchanges the code and redirects back to `WEB_ORIGIN`. Keep Microsoft and database credentials exclusively on the API.

Render deploys are triggered deliberately (`autoDeployTrigger: off`). Deploy coordinated API/frontend changes in a compatible order; a Vercel deployment does not trigger a Render deployment. Configure the Vercel Git deployment workflow accordingly. No service is created merely by adding these files to the repository.

Sources: [Render Node versions](https://render.com/docs/node-version), [Python versions](https://render.com/docs/python-version), [monorepos](https://render.com/docs/monorepo-support), [private services](https://render.com/docs/private-services).

## Migrations

The API's **pre-deploy command** applies committed Drizzle migrations after a successful build and before the new API release starts:

```sh
npm run db:migrate --workspace=@roller-bay/api
```

A migration failure blocks that deployment. Migrations do not run in frontend/solver builds or on each API process startup. Render runs pre-deploy work on a separate instance; database changes persist even though local filesystem changes do not.

Generate migrations deliberately, inspect the SQL and metadata, test them on a migrated staging database, and commit them together. Never generate migrations during deployment. Applying migrations locally remains an explicit action.

Keep schema changes compatible with the still-running previous API release: add new structures first, deploy compatible code, then remove obsolete structures in a later release. An application rollback does not undo database migrations. Avoid independent migration jobs targeting the same database during an API deployment, and verify a recovery point before changes that put existing data at risk.

See [Render pre-deploy commands](https://render.com/docs/deploys#pre-deploy-command). No migrations have been generated or applied as part of configuring this deployment.

## Health, proxy trust, and staging verification

| Endpoint             | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `/api/health`        | API process liveness, including during storage outages                    |
| `/api/health/ready`  | Bounded PostgreSQL and Redis connectivity checks; API Render health check |
| `/api/health/solver` | Independent solver availability; does not disable manual workflows        |

Check these through the public Vercel origin as well as directly on the Render API. The private solver uses Render's TCP health checks. Readiness does not verify migration completeness or perform an optimization.

Before production, verify the actual Vercel → Render forwarding chain. Scope `TRUSTED_PROXY_IPS` to verified proxies; do not use blanket trust or guess a hop count. The API must recognize HTTPS for Secure cookies and identify real client addresses for rate limiting. An empty trust list safely ignores forwarded headers, but is not the final production proxy configuration.

Verify real Microsoft sign-in, logout, `__Host-roller_bay.sid` cookie attributes, authenticated reads/writes, wrong-Origin rejection, and forwarding-header spoof rejection. Confirm two distinct clients do not share a proxy-wide rate-limit bucket. Check that session and inventory responses are not cached by Vercel. Test a realistic long optimization through `/api`, dependency outages and recovery, and that the API remains responsive during a solve.

Run the shared/API/web checks and solver tests described in [repository guidance](../AGENTS.md). The frontend has focused tests for API URL selection and rewrite configuration. Local tests do not establish Vercel edge behavior, Render networking, real Microsoft login, or production capacity; complete those checks in staging.

Local verification on 2026-09-16: API/web typechecks and lint, 94 API tests (4 integration suites skipped without opt-in), 61 frontend tests, and 10 solver tests passed. The exact native API and frontend build commands passed in clean Linux ARM64 Node 24 environments. A production Next.js server forwarded paths, queries, request bodies, cookies, Origin/idempotency headers, and callback redirects to a local HTTPS fixture. Render validated the Blueprint. No hosted deployment, real Microsoft sign-in, or migration application was performed; these checks do not validate the Vercel edge or Render ingress chain.

Backups remain a separate operational increment: managed PostgreSQL recovery, independent encrypted exports, and practiced restoration are still needed. Native hosting does not replace a tested recovery process.
