# Repository guidance

Roller Bay Ops tracks physical fabric rolls and remnants, receiving, storage locations, and production allocations for a window covering company. Start with [README.md](README.md) and the relevant feature document in [docs/](docs/); verify current behavior against the code when documentation and implementation disagree.

## Working with the user

- Work incrementally within the requested scope. Design discussions and requests for recommendations do not authorize implementation.
- File edits, commits, and pushes require user authorization. Session authorization remains valid until revoked; do not repeatedly ask for permission already given. Treat migration generation and application as separate actions requiring authorization, and honor any explicit stop before a commit.
- Inspect the current branch and working tree first. Preserve unrelated changes and make focused commits for coherent additions. Do not rewrite history unless requested.
- Explain questionable boundaries, misleading names, or unnecessary abstractions instead of extending them unquestioningly. Prefer concrete implementations until a real substitution boundary is needed.
- Add comments for rationale, invariants, and complex or ambiguous logic. Avoid narrating obvious code or duplicating details likely to change.
- Report what changed, what was verified, and any remaining limitations. Distinguish mocked tests from live integrations and visual inspection.

## Architecture

- Use npm workspaces and Turborepo. The root scripts run tasks in dependency order; workspace scripts support focused checks.
- `apps/api` is the NestJS backend. Organize vertical slices under `src/features/<feature>/`, keeping controllers, services, repositories, tables, and tests with their feature.
- Controllers handle HTTP concerns and input validation. Services own business rules and orchestration. Repositories own database queries. Keep transaction handling explicit without building a second repository API inside transaction callbacks.
- Drizzle tables live in feature-owned `*.table.ts` files, grouped in `tables/` where appropriate. `src/database` owns connection infrastructure, not domain models.
- `packages/shared` owns public Zod schemas and inferred TypeScript types. Import through explicit feature exports such as `@roller-bay/shared/allocations`; do not import another workspace's source directly. Keep Drizzle rows, Nest classes, and UI components out of public contracts.
- `apps/web` is the Next.js App Router frontend. Keep routes and layouts thin; feature screens, API operations, forms, and query definitions belong under `src/features`. Shared UI belongs in `components`, small infrastructure utilities in `lib`, and semantic theme tokens in `styles`.
- `apps/solver` is a standalone Python service for generic mathematical models. Provider implementations, including OR-Tools, belong there. The backend's `src/solver` wrapper remains independent of fabric rules; cutting validation and model construction belong in allocations. Python uses snake_case with aliases at camelCase wire boundaries.
- A folder grouping or controller route prefix is not automatically a facade. Introduce coordinating interfaces only when a concrete consumer needs them.

## Feature boundaries

Each feature owns its state mutations and implementation details; see [feature boundaries](docs/feature-boundaries.md) for entry points, exceptions and the check.

- Cross-feature imports use the owning feature's explicitly exported public API: `index.ts`, and in the API also `tables.ts` and, for tests, `testing/index.ts`. Deep imports into another feature are prohibited unless documented as an architectural exception.
- Pure domain contracts, types, validators, calculators, and lookup/query APIs may be exposed for cross-feature use. Presenters, controllers, repository internals, screens and editors are private by default.
- Repositories may read tables owned by other features when required for feature-owned queries, but mutate only their own feature's tables. Mutations and domain effects in another feature go through that feature's service using explicit named operations.
- Cross-feature workflows are coordinated by the service that owns the workflow and propagate the current unit of work explicitly.
- UI composition involving multiple features belongs in the route layer, not in feature-to-feature UI dependencies.
- Feature dependency cycles are prohibited. Extract shared concepts upward rather than resolving them with circular imports. `npm run check:boundaries` enforces these rules in CI.

## Domain boundaries

- A fabric **color** is the company's unique fabric identifier, not simply a visual color. Keep the manufacturer → material → color hierarchy and the established feature names: `fabric-catalog`, `locations`, `stock-items`, `stock-receipts`, `work-orders`, and `allocations`.
- Stock receipts record fabric that has arrived. Keep `purchaseOrderNumber` for supplier paperwork; do not rename the receiving workflow to purchase orders.
- The API and database use millimetres. The UI defaults to inches for widths, drops, and cutting measurements, yards for roll length, and millimetres for thickness and roll measurements, including tube outer diameter; each user may choose a unit per measurement field in Settings, stored on the user record. Preserve the shared contracts' precision; blanks must not become zero.
- Roll depth is radial: `(outer diameter − tube diameter) / 2`. Explicit remaining length belongs to remnants. Consult [stock-items](docs/stock-items.md) and [roll measurement](docs/roll-measurement.md) before changing measurement or lifecycle rules.
- Drafts use existing typed tables and `is_draft`. They may be incomplete and never create stock or reserve fabric. Preserve revision checks, idempotency, same-ID submission, and atomic rollback.
- A work order (`work-orders`) is the one definition of a production order: its number, note and stated blind quantity. It exists without an allocation. An allocation names its order by `workOrderId` and holds the blinds it plans (`allocation_requirements`) with the fabric plan that cuts them; the blinds it confirms must add up to the order's quantity, which is fixed while the order has a live allocation. An order has at most one live allocation. Confirmation stamps `allocated_at`; inventory completion does not stamp production milestones. Whole-order cancellation explicitly coordinates order stopping, date clearing and fabric release; it preserves production facts and completed inventory effects. Released completed allocations remain historical and do not occupy the live slot. These named workflow requests are the writes that cross between the features: allocation requests never create or edit an order, and work-orders writes no allocation table. Keep new cross-feature effects explicit requests, not side effects. Each allocation keeps its own blinds, so a cancelled or completed plan still shows what it was made for. Order milestone writes belong to work-orders; its status is derived, never stored. Deleted orders are kept (`deleted_at`) because allocations reference their number; reads leave them out and creating the number again restores the order. Setting or changing a ship date requires a live allocation or a back order (the supplier purchase orders bringing the fabric); a back-ordered order's allocation is confirmed only once a submitted stock receipt carries each of its numbers, and the back order stays on the order as a record once fabric is allocated. Allocation cancellation preserves an existing date and flags the order as needing fabric; unscheduling clears only the date, while whole-order cancellation clears the date and releases fabric atomically. The order number is unrelated to a receipt's `purchaseOrderNumber`; a back order's purchase-order numbers match receipts by value, never by key.
- Receipt and allocation features orchestrate their workflows; stock mutations belong to stock-items. Only confirmed, active allocations affect reservations and availability.
- Cutting plans preserve orientation, drop-first straight cuts, edge trimming, allowances, and stock availability. Every optimizer result must pass the cutting-plan validator. A bounded search result does not establish global optimality. See [allocations](docs/allocations.md) and [solver](docs/solver.md).

## Frontend and authentication

- Keep the UI practical and minimalist: concise labels, useful instructions, and operational data. Avoid promotional banners, slogans, and redundant descriptions. Preserve the glassy light/dark theme, accessible controls, and desktop/tablet usability. The color palette is stored on the user record; light/dark/system mode stays in the browser.
- TanStack Query owns server data; URL parameters own filters and pagination; forms own unsaved input. Validate API responses using shared schemas.
- Do not optimistically update balances, reservations, or submissions. Background refetches must not overwrite dirty forms; conflicts preserve input and retries preserve the original submission key/payload or revision.
- Microsoft OAuth and Redis sessions belong to the backend. Browser requests include session credentials; the backend remains authoritative for permissions. Preserve CSRF/Origin checks, CORS, rate limiting, and private-cache clearing on session expiry/logout.
- Keep server output and the first client render consistent. Use the existing hydration helper for browser-only session/theme state rather than suppressing hydration errors.

## Verification and local development

Use the versions in `.nvmrc` and `package.json`. Build shared contracts before running dependent workspace checks directly:

```sh
npm run build --workspace=@roller-bay/shared
npm run typecheck --workspace=@roller-bay/api
npm run lint --workspace=@roller-bay/api
npm test --workspace=@roller-bay/api
npm run typecheck --workspace=@roller-bay/web
npm run lint --workspace=@roller-bay/web
npm test --workspace=@roller-bay/web
npm run build --workspace=@roller-bay/web
npm run check:boundaries
```

- `npm test --workspace=@roller-bay/api` runs unit tests only; `*.integration.test.ts` and `*.live-solver.test.ts` run through their own scripts and fail, never skip, when their services are missing. No suite reads a `.env` file: test modules build their configuration inline with `ignoreEnvFile: true`.
- Run checks appropriate to the changed workspaces. Add focused tests for meaningful behavior, especially concurrency, validation, and retry handling; copy-only changes do not need new unit tests.
- Browser workflows: `npm run test:e2e --workspace=@roller-bay/web`. These build the app and serve the production build on port 3100 with intercepted API responses, so they run beside a Next dev server; never start a second `next dev` in the same checkout, since changing ports does not avoid its dev lock. Do not stop the user's server without coordination.
- PostgreSQL/Redis integration tests: `npm run test:integration` with the compose services running (`npm run services:up`); `TEST_DATABASE_URL` and `TEST_REDIS_URL` override them. Each `*.integration.test.ts` file starts the app through `src/testing/integration-app.ts` in its own throwaway database, built by applying the migrations, and never touches the application database; that is the only place migrations are applied without asking. Files must not depend on each other or on run order. Setup several files share goes in the harness's `fixtures` or a feature's `testing/` folder; SQL that is a test's subject stays in the test. Split a suite by concern when it outgrows one file. See [testing](docs/testing.md). Missing infrastructure is not a reason to weaken tests.
- Solver checks: `npm test --workspace=@roller-bay/solver` and `npm run lint --workspace=@roller-bay/solver`. Real HTTP integration: `npm run test:solver --workspace=@roller-bay/api`, which starts and stops its own solver and needs only the solver virtualenv. See [solver setup](docs/solver.md).
- CI (`.github/workflows/ci.yml`) runs every check above on pull requests and on pushes to `dev` and `main`, from a checkout with no `.env` files. Change it in the same commit as the script or check it runs.
- Format only touched files with Prettier and check `git diff --check`. Use the solver's Ruff commands for Python.
- When authorized, generate migrations with `npm run db:generate -- --name=change_name`, inspect the SQL and metadata, then apply with `npm run db:migrate`. Preserve existing data; do not add runtime schema-repair workarounds or reset migration history unless explicitly requested. Commit generated SQL and Drizzle metadata together.
- Keep credentials in ignored environment files. Never print or commit secrets, overwrite existing local configuration with examples, or put private values in `NEXT_PUBLIC_*` variables.

Keep this file focused on durable guidance. Detailed workflows belong in the relevant `docs/` file; `CLAUDE.md` imports this file so instructions are maintained once.
