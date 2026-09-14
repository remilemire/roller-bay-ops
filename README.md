# Roller Bay Ops

Roller Bay Ops tracks individual fabric stock items for a window covering company. It connects purchase-order receipts, warehouse and shelf locations, order allocations, and paper cutting forms. Stock is tracked by the company’s fabric “color” identifier and individual roll or piece; remaining roll length is calculated from physical measurements after cutting.

See the [product brief](docs/product-brief.md) for the workflows, proposed feature boundaries, open decisions, and recommended implementation sequence.

The current implementation is a TypeScript monorepo with a Next.js App Router frontend, a NestJS API, and shared Zod contracts. The **notes** feature is a technical example only; the fabric workflows are not implemented yet.

## Get started

Use Node.js 24 LTS (`nvm use`) and npm 11. Docker with Compose provides local PostgreSQL and Redis services. Existing installations also work if you update `DATABASE_URL` and `REDIS_URL`.

From the repository root:

```sh
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run services:up
npm run db:migrate
npm run dev
```

Before `npm run dev`, fill in the Microsoft and session settings in `apps/api/.env` using the [authentication setup](docs/authentication.md). Required values are intentionally blank in the example. API startup rejects incomplete configuration.

- Frontend: <http://localhost:3000>
- API liveness: <http://localhost:3001/api/health>
- Example feature (sign-in required): `GET /api/notes` and `POST /api/notes` with `{"title":"First note"}`
- PostgreSQL: `localhost:5434` (the container uses port 5432 internally)
- Redis: `localhost:6380` (the container uses port 6379 internally)

Local environment files are ignored by Git. The database credentials and unauthenticated Redis service in the examples are for local development only; both ports bind to localhost. The API validates its environment on startup. `/api/health` reports process liveness; it does not check PostgreSQL or Redis availability. Use authenticated notes API requests to exercise the database connection.

`npm run dev` builds shared contracts before starting the applications. Turborepo watches the dependency graph and rebuilds shared contracts and restarts dependent development tasks when they change. Stop the development processes with Ctrl+C; stop the backing services separately with `npm run services:down`. PostgreSQL and Redis data stay in separate Compose volumes.

## Redis

Redis stores application sessions and short-lived Microsoft login transactions. Session lifetime defaults to seven days, without extending on activity.

See the [authentication plan](docs/auth-plan.md) for Microsoft sign-in, Redis sessions, and email handling decisions.

Set `REDIS_URL=redis://localhost:6380` in `apps/api/.env`. The API connects before it starts listening and fails startup if the initial connection fails. After a successful connection, it retries interruptions with backoff. Commands issued while disconnected fail immediately instead of queuing. Shutdown closes the connection and stops retries.

Features that need Redis import `RedisModule` and inject `RedisService`, using its `client` directly. The auth feature owns session behavior; `src/redis` only manages the shared connection. Redis does not require a Drizzle model or migration.

The `session-redis` Compose service uses append-only persistence with a sync every second and a dedicated volume. A sudden failure can lose roughly the most recent second of writes. The `noeviction` policy prevents memory pressure from silently evicting sessions; auth sets each session's expiry. This local configuration does not impose a memory cap. For deployment, configure authenticated Redis with TLS (`rediss://`) and appropriate memory limits. See [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) and [Node client connections](https://redis.io/docs/latest/develop/clients/nodejs/connect/).

## Layout

```text
apps/
  web/
    src/app/                    # Next.js route entries, layouts, global styles
    src/features/notes/         # Feature UI and HTTP calls
  api/
    src/features/
      auth/                     # Microsoft login, Redis sessions, access guard
      users/                    # User profiles, roles, and persistence
      notes/                    # Controller, service, repository, table, tests
      health/                   # Liveness endpoint
    src/database/               # Connection pool and lifecycle only
    src/redis/                  # Redis connection and lifecycle only
    src/config/                 # Environment validation
    src/common/pipes/           # Reusable HTTP validation
    drizzle/                    # Generated SQL migrations and metadata
packages/
  shared/
    src/features/notes/         # Zod request/response schemas and inferred types
    src/features/users/         # Roles, normalized email, public user schema
    src/features/auth/          # Current-user response contract
```

## Adding a feature

First agree on the workflow, business rules, and feature ownership. Then implement a small use case across the layers below, rather than designing every model or endpoint up front.

1. Define its public request and response schemas under `packages/shared/src/features/<feature>/`. Infer TypeScript types with `z.infer` and add a feature subpath to the shared package's `exports`.
2. Create a Nest module under `apps/api/src/features/<feature>/` and register it in `AppModule`. Keep controllers, business rules, database queries, tables, and tests together inside that feature.
3. Put Drizzle tables in `*.table.ts` files. The migration configuration discovers those files across all API features. Generate and inspect a migration, then apply it.
4. Put the UI and feature-specific API calls under `apps/web/src/features/<feature>/`. Keep `src/app` route files thin: they compose feature screens.

Controllers handle HTTP and validate inputs with the Zod pipe. Services own business behavior and map database rows into public responses. Repositories own database queries. `src/database` owns the shared connection pool, not feature models.

Both applications import contracts from `@roller-bay/shared/notes`. The shared package builds to JavaScript and declaration files so Nest can execute its schemas and Next can bundle them. Its API is limited to explicit feature exports; avoid importing another workspace's source files directly.

**Database models and API contracts are different boundaries.** Drizzle infers database row types; Zod infers public request/response types and validates runtime input. Do not export Drizzle tables, database credentials, Nest classes, or database row types to the browser. For example, `createdAt` is a `Date` in the database layer and an ISO string in the JSON contract. Avoid defining duplicate hand-written interfaces for a Zod schema.

## Commands

| Command                                     | Purpose                                                        |
| ------------------------------------------- | -------------------------------------------------------------- |
| `npm run dev`                               | Watch the frontend, API, and shared contracts                  |
| `npm run build`                             | Build the three workspaces in dependency order                 |
| `npm start`                                 | Run both built apps; run `build` first                         |
| `npm run typecheck`                         | Check application, contract, and migration configuration types |
| `npm run lint`                              | Check TypeScript and Next.js conventions                       |
| `npm test`                                  | Test contracts, normalization, and simulated Microsoft sign-in |
| `npm run test:integration`                  | Test auth with local Redis and PostgreSQL; requires test URLs  |
| `npm run format`                            | Format source and configuration                                |
| `npm run format:check`                      | Check formatting without changing files                        |
| `npm run services:up`                       | Start PostgreSQL and Redis and wait until healthy              |
| `npm run services:down`                     | Stop PostgreSQL and Redis and preserve data                    |
| `npm run db:up`                             | Start local PostgreSQL and wait until healthy                  |
| `npm run db:down`                           | Stop local PostgreSQL and preserve data                        |
| `npm run redis:up`                          | Start local Redis and wait until healthy                       |
| `npm run redis:down`                        | Stop local Redis and preserve data                             |
| `npm run db:generate -- --name=change_name` | Generate a SQL migration from feature tables                   |
| `npm run db:migrate`                        | Apply pending migrations                                       |
| `npm run db:studio`                         | Open Drizzle Studio for the configured database                |

Commit generated SQL and the `drizzle/meta` files together. Migrations run explicitly, not automatically at API startup. Database commands load `apps/api/.env`, because npm runs them from the API workspace. The web application reads `apps/web/.env.local`; `NEXT_PUBLIC_API_URL` is public and is embedded at build time.

To verify the starter:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
```

The default tests verify notes contracts, email normalization, directory policy, configuration validation, and signed OIDC responses from a simulated provider. The optional `npm run test:integration` suite exercises auth against real Redis and PostgreSQL; see its [setup and scope](docs/authentication.md#tests).

Microsoft authentication is implemented in the backend. Notes require an authenticated session; a frontend login screen and credentialed API calls are still a separate step, so the existing demo UI is not yet integrated with auth. Role-specific permissions, pagination, and deployment remain future work.

The root package overrides Nest's transitive `multer` dependency and Drizzle Kit's legacy loader's `esbuild` dependency to patched releases. Recheck those overrides when upgrading the parent packages. ESLint stays on version 9 to match the peer dependencies of Next.js's React, import, and accessibility plugins.

## Framework references

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [NestJS first steps](https://docs.nestjs.com/first-steps)
- [Drizzle with PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)
- [Zod schemas and type inference](https://zod.dev/)
