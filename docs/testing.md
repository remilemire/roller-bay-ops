# Testing

No suite reads a `.env` file or needs shell setup. Test modules build their configuration inline (`ConfigModule.forRoot({ ignoreEnvFile: true, load: [...] })`), and the few variables a suite accepts have safe defaults.

## Commands

| Command                                           | Runs                                                   | Needs                                       |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `npm test --workspace=@roller-bay/api`            | API unit tests                                         | Nothing                                     |
| `npm run test:integration`                        | API over real PostgreSQL and Redis, one file a feature | `npm run services:up`                       |
| `npm run test:solver --workspace=@roller-bay/api` | API against a real solver over HTTP                    | The solver virtualenv ([solver](solver.md)) |
| `npm test --workspace=@roller-bay/web`            | Web unit tests (Vitest)                                | Nothing                                     |
| `npm run test:e2e --workspace=@roller-bay/web`    | Browser workflows (Playwright, intercepted API)        | Chromium: `npx playwright install chromium` |
| `npm test --workspace=@roller-bay/solver`         | Solver unit tests                                      | The solver virtualenv                       |

API test files are named for the run that owns them: `*.test.ts` (unit), `*.integration.test.ts`, and `*.live-solver.test.ts`. Each script selects only its own files, and nothing skips: a suite run without its services fails. Every API script clears `.test-dist` before compiling, because `tsc` never deletes the output of a test that was renamed or removed, and runs Node with `--throw-deprecation`, so a deprecation from application code or a dependency fails the run instead of scrolling past.

## Integration tests

Each `*.integration.test.ts` file starts the whole API through `startIntegrationApp` or `startSignedInApp` in `apps/api/src/testing/integration-app.ts`: its own database, Redis key prefix, loopback listener and, for most features, one signed-in employee, all removed when the file's test ends. Files are therefore independent of each other and of run order, and run in parallel, four at a time so connections stay well under PostgreSQL's limit. Microsoft sign-in is replaced by a provider the test controls; no real credentials are used.

The database is created for the run (`rb_test_<hex>`), built by applying every migration in `apps/api/drizzle`, and dropped afterwards. Tests therefore see exactly the constraint and index names production has, and every run also proves the migrations apply to an empty database. The migrations qualify their objects with `public`, which is why this is a database and not a schema. The suite never reads or writes the application database: the server connection is used for one `CREATE DATABASE` and one `DROP DATABASE` of a name the run generated, so the development server is a safe target.

A feature whose suite outgrows one file is split by concern, not by size alone: allocations has files for planning, completion, scheduled orders, drafts and completion corrections. Each file sits with the feature that owns the routes it calls, so corrections are tested in stock-receipts, allocations and stock-items rather than beside the audit trail they write to. Setup and helpers that belong to one feature live in a `testing/` folder inside it (`features/allocations/testing/allocations-app.ts`; `features/stock-items/testing/stock-commands.ts`, which posts audited corrections and voids at the stock's current revision); setup that spans features, such as `startCorrectionsApp`, which receives, allocates and completes stock, lives in `apps/api/src/testing/`. Both wrap the harness and are left out of the production build. Subtests within a file may share that setup but not each other's records.

`database/migrations.integration.test.ts` is the one suite that does not start migrated: it applies the migrations up to one that moves data or adds a rule existing rows might break (0028, 0029), seeds rows as they were, applies it, and checks where they landed and that each of its guards stops it. Add a case there for any migration that moves or rewrites rows, since the other suites only prove migrations apply to an empty database.

The harness also returns `fixtures` (`apps/api/src/testing/fixtures.ts`): rows a test needs but is not about, such as the session user's role, a color and location, or a work order with its blinds, written straight to the database. Only setup that several files share belongs there. SQL that is a test's own subject, such as blanking a column to stand in for a legacy row or adding a trigger to force a write failure, stays in that test, where it explains itself.

`TEST_DATABASE_URL` and `TEST_REDIS_URL` override the defaults, which are the compose services (`localhost:5434` and `localhost:6380`).

Run one feature:

```sh
npm run test:build --workspace=@roller-bay/api
node --throw-deprecation --test apps/api/.test-dist/features/allocations/allocations.integration.test.js
```

A run killed by a signal cannot clean up and leaves its database behind. Nothing sweeps them automatically, since a sweep could drop the database of a file running in parallel. To remove leftovers when no tests are running:

```sh
psql "$TEST_DATABASE_URL" -Atc "SELECT format('DROP DATABASE %I WITH (FORCE)', datname) FROM pg_database WHERE datname LIKE 'rb_test_%'" | psql "$TEST_DATABASE_URL"
```

## Solver tests over HTTP

`*.live-solver.test.ts` files call `startSolver` in `apps/api/src/testing/live-solver.ts`, which starts the standalone service on a free port with a generated key and every variable the service reads set explicitly, then stops it. They depend on neither `apps/solver/.env` nor a solver already running. Files run one at a time because the service admits one request at a time.

## Browser tests

Playwright builds the app and serves the production build on port 3100: it is what ships, and it runs beside a `next dev` server, where a second `next dev` in the same checkout would fight the first for its dev lock. The server is never reused, because a production server left running would serve a stale build; if port 3100 is taken the run fails instead.

Every API response is intercepted by `mockApi` in `apps/web/tests/e2e/fixtures.ts`; no backend runs. The build's API variables are set in `playwright.config.ts` rather than inherited, which overrides `apps/web/.env.local`, and `mockApi` fails any API call that is not same-origin, so a leaked API URL cannot pass unnoticed. The browser's timezone is pinned to `America/Edmonton`, west of Greenwich, where a calendar day mishandled as a local time slips to the day before; fixed clocks in specs carry an explicit offset.

Nothing is retried, locally or on CI. Intercepted responses and a fixed clock make these tests deterministic, so a test that passes on a second attempt has found a race in the UI, which is worth a failure.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `dev` and `main`; a newer push to the same ref cancels the run in progress. Five jobs run in parallel, each the same commands as above on the Node version in `.nvmrc`:

| Job      | Runs                                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| `static` | Prettier check, lint and typecheck of the TypeScript workspaces                         |
| `api`    | API unit tests, then the integration suite against PostgreSQL and Redis containers      |
| `web`    | Vitest and the production build                                                         |
| `e2e`    | Browser tests; traces of failed tests are uploaded as the `playwright-results` artifact |
| `solver` | Solver unit tests and Ruff, then the API's solver tests over HTTP                       |

A CI checkout has no `.env` files, so a test that came to depend on one fails there. The `api` job sets `TEST_DATABASE_URL` and `TEST_REDIS_URL` for its containers; no other job sets a variable, and the workflow uses no secrets. There is no separate migration check, because every integration file applies all migrations to an empty database. CI does not deploy, and deploys do not wait for it ([deployment](deployment.md)). Requiring the jobs before a merge is a branch protection setting on GitHub.

## Listeners

A test that uses Supertest against a server that is not yet listening must listen first on `127.0.0.1` (`await app.listen(0, '127.0.0.1')`). Given a non-listening server, Supertest binds a wildcard port for every request and then connects to `127.0.0.1`; on macOS that port can already belong to another local process on IPv4, which then answers the request.

## Unit of work

Service unit tests can use `stubUnitOfWork` from `apps/api/src/testing/unit-of-work.ts` to supply repository methods. It invokes callbacks directly and does not simulate PostgreSQL commit, rollback, or isolation.

The unit-of-work unit suite exercises Drizzle against a recording driver to verify transaction connection use across all repositories, commit failures, rollback, and connection release. Its integration suite uses the normal isolated application harness to verify concurrent units, snapshot consistency, read-only enforcement, atomic domain/audit/idempotency writes, and transaction-local timeouts on a reused connection. Production integration tests also assert that worksheet review calls allocation completion inside one database transaction and rolls everything back on a late audit failure.

See [Unit of work](unit-of-work.md) for the context-passing convention.
