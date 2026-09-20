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

## Listeners

A test that uses Supertest against a server that is not yet listening must listen first on `127.0.0.1` (`await app.listen(0, '127.0.0.1')`). Given a non-listening server, Supertest binds a wildcard port for every request and then connects to `127.0.0.1`; on macOS that port can already belong to another local process on IPv4, which then answers the request.
