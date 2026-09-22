# Roller Bay Ops

Roller Bay Ops tracks individual fabric stock items for a window covering company. It connects stock receipts, warehouse and shelf locations, order allocations, and paper cutting forms. Stock is tracked by the company’s fabric “color” identifier and individual roll or piece; remaining roll length is calculated from physical measurements after cutting.

See the [product brief](docs/product-brief.md) for the operational workflows, domain terminology, and current scope.

See [deployment](docs/deployment.md) for the Vercel frontend, Render API and solver, same-origin `/api` routing, health checks, and pre-deploy migrations.

The [locations API](docs/locations.md) manages zones, sections, and storage levels with admin-controlled writes.

The [work orders API](docs/work-orders.md) lists production orders with ship dates and a status derived from their milestones.

The current implementation is a TypeScript monorepo with a Next.js App Router frontend, a NestJS API, shared Zod contracts, and a standalone Python solver. User profiles, Microsoft authentication, the fabric catalog API, and [stock lookup and admin CRUD](docs/stock-items.md) are implemented in the backend. [Stock-receipt receiving](docs/stock-receipts.md) is also implemented in the backend. The [frontend workspace](docs/frontend.md) includes Microsoft sign-in, light/dark themes, reference-data management, stock lookup and corrections, receipt drafts, and allocation planning, [station production tracking and digital cutting sheets](docs/production.md). The [allocation API](docs/allocations.md) supplies validation, bounded optimization, reservations, and completion. See the [catalog endpoints and permissions](docs/fabric-catalog.md) and [user activation](docs/authentication.md#user-activation), and [roles and ownership](docs/authentication.md#roles-and-ownership). API failures share one [error envelope](docs/errors.md). [Testing](docs/testing.md) describes the suites and how to run them.

## Get started

Use Node.js 24 LTS (`nvm use`) and npm 11. Docker with Compose provides local PostgreSQL and Redis services. Existing installations also work if you update `DATABASE_URL` and `REDIS_URL`.

From the repository root:

```sh
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run services:up
npm run db:migrate
```

Before starting the applications, fill in the Microsoft and session settings in `apps/api/.env` using the [authentication setup](docs/authentication.md). Required values are intentionally blank in the example. API startup rejects incomplete configuration.

Complete the [local solver setup](docs/solver.md#run-locally), including its Python environment and matching API key, then run `npm run dev`. The root command starts the frontend, API, and solver. To run without optimization, use `npx turbo watch dev --filter=@roller-bay/web --filter=@roller-bay/api`; manual allocation workflows remain available.

- Frontend: <http://localhost:3000>
- API liveness: <http://localhost:3001/api/health>
- Current user (sign-in required): `GET /api/auth/me`
- PostgreSQL: `localhost:5434` (the container uses port 5432 internally)
- Redis: `localhost:6380` (the container uses port 6379 internally)

Local environment files are ignored by Git. The database credentials and unauthenticated Redis service in the examples are for local development only; both ports bind to localhost. The API validates its environment on startup. `/api/health` reports process liveness; `/api/health/ready` checks PostgreSQL and Redis. `/api/health/solver` monitors the optional solver separately.

`npm run dev` builds shared contracts before starting the applications. Turborepo watches the dependency graph and rebuilds shared contracts and restarts dependent development tasks when they change. Stop the development processes with Ctrl+C; stop the backing services separately with `npm run services:down`. PostgreSQL and Redis data stay in separate Compose volumes.

## Redis

Redis stores application sessions, short-lived Microsoft login transactions, and shared rate-limit counters. Session lifetime defaults to seven days, without extending on activity. See [rate limiting](docs/authentication.md#rate-limiting) for request budgets and configuration.

See [authentication](docs/authentication.md) for Microsoft sign-in, session behavior, and email handling.

Set `REDIS_URL=redis://localhost:6380` in `apps/api/.env`. The API connects before it starts listening and fails startup if the initial connection fails. After a successful connection, it retries interruptions with backoff. Commands issued while disconnected fail immediately instead of queuing. Shutdown closes the connection and stops retries.

The auth feature owns session behavior; `src/redis` manages the shared connection.

The `session-redis` Compose service uses append-only persistence with a sync every second and a dedicated volume. A sudden failure can lose roughly the most recent second of writes. The `noeviction` policy prevents memory pressure from silently evicting sessions; auth sets each session's expiry. This local configuration does not impose a memory cap. For deployment, configure authenticated Redis with TLS (`rediss://`) and appropriate memory limits. See [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) and [Node client connections](https://redis.io/docs/latest/develop/clients/nodejs/connect/).

## Layout

```text
apps/
  web/
    src/app/                    # Thin routes, layouts, providers, boundaries
    src/features/               # Screens, API calls, forms, and feature tests
    src/components/             # Shared UI primitives and dashboard shell
    src/lib/                    # HTTP, query configuration, measurements
    src/styles/                 # Theme tokens and shared styles
  api/
    src/features/
      auth/                     # Microsoft login, Redis sessions, access guard
        sessions/               # Browser-session module, service, repository
        oauth-transactions/     # Login-transaction module, service, repository
      users/                    # User profiles, activation, roles, and ownership
      fabric-catalog/           # Groups manufacturer, material, and color modules
        manufacturers/          # Manufacturer module and vertical slice
        materials/              # Material module and vertical slice
        colors/                 # Color module and vertical slice
      health/                   # Liveness, storage readiness, solver monitor
      locations/                # Zones, sections, and storage levels
      stock-items/              # Physical rolls/remnants and admin CRUD
      stock-receipts/            # Receipts, drafts, and idempotent submission
      work-orders/           # Production orders, ship dates, and milestones
      allocations/              # Cutting plans, reservations, and completion
      audit/                    # Stock and workflow change history
    src/solver/                 # Generic HTTP client for the Python solver
    src/database/               # Connection pool and lifecycle only
    src/redis/                  # Redis connection and lifecycle only
    src/rate-limiting/          # API and login request budgets backed by Redis
    src/config/                 # Environment validation
    src/common/pipes/           # Reusable HTTP validation
    src/common/errors/          # Error envelope filter and request-error curation
    drizzle/                    # Generated SQL migrations and metadata
  solver/
    service/                    # Python HTTP service and solver providers
    tests/                      # Solver validation and integration tests
packages/
  shared/
    src/features/users/         # Roles, normalized email, public user schema
    src/features/auth/          # Current-user response contract
    src/features/fabric-catalog/ # Catalog request and response contracts
    src/features/locations/     # Storage location contracts
    src/features/stock-items/   # Physical stock contracts
    src/features/stock-receipts/ # Receipt and draft contracts
    src/features/work-orders/ # Work order contracts
    src/features/allocations/   # Planning, draft, and completion contracts
    src/features/corrections/   # Correction contracts
    src/features/audit/         # History contracts
    src/errors/                 # Error envelope shared by the API and the web app
```

Development conventions and contribution instructions are maintained in [AGENTS.md](AGENTS.md).

## Commands

| Command                                     | Purpose                                                        |
| ------------------------------------------- | -------------------------------------------------------------- |
| `npm run dev`                               | Watch the frontend, API, solver, and shared contracts          |
| `npm run build`                             | Build shared contracts, API, and frontend in dependency order  |
| `npm start`                                 | Run the frontend, API, and solver; run `build` first           |
| `npm run typecheck`                         | Check application, contract, and migration configuration types |
| `npm run lint`                              | Check TypeScript, Next.js, and Python conventions              |
| `npm test`                                  | Run workspace tests, including the Python solver               |
| `npm run test:integration`                  | Run database/Redis integration suites against the services     |
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

Local migrations run explicitly. Render applies committed migrations in the API pre-deploy step, never at app startup. Database commands load `apps/api/.env`, because npm runs them from the API workspace. The web application reads `apps/web/.env.local`; `NEXT_PUBLIC_API_URL` is public and is embedded at build time.

See [AGENTS.md](AGENTS.md#verification-and-local-development) for verification commands and [testing](docs/testing.md) for the suites, their setup, and the [CI](docs/testing.md#ci) that runs them on pull requests and on `dev` and `main`. The root lint and test commands also require the solver's Python environment. Browser tests use intercepted API responses; PostgreSQL, Redis, solver HTTP, and live Microsoft sign-in checks are separate integrations.

The root package overrides Nest's transitive `multer` dependency and Drizzle Kit's legacy loader's `esbuild` dependency to patched releases. Recheck those overrides when upgrading the parent packages. ESLint stays on version 9 to match the peer dependencies of Next.js's React, import, and accessibility plugins.

## Framework references

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [NestJS first steps](https://docs.nestjs.com/first-steps)
- [Drizzle with PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)
- [Zod schemas and type inference](https://zod.dev/)
