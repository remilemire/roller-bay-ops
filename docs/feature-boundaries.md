# Feature boundaries

Each feature owns its state mutations and implementation details. Other features use it only through the public API it deliberately exports.

| Kind                                       | Cross-feature access                                            |
| ------------------------------------------ | --------------------------------------------------------------- |
| Public contracts and pure domain utilities | Allowed                                                         |
| Read-only data dependencies                | Allowed deliberately, preferably through an explicit read query |
| Stateful behavior, writes and workflows    | Only through the owning feature's service, by named operations  |
| Internal implementation details            | Not allowed                                                     |

## Entry points

Cross-feature imports use the owning feature's entry points; deep imports into another feature are refused.

| Entry                        | Workspace | Exports                                                                                | Imported by                             |
| ---------------------------- | --------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| `<feature>/index.ts`         | api       | Module, services, pure helpers, error factories and public types                       | Features that depend on it; the app     |
| `<feature>/tables.ts`        | api       | Drizzle tables and column metadata                                                     | Any feature, for foreign keys and reads |
| `<feature>/testing/index.ts` | api       | Test fixtures, and internals only tests reach                                          | Tests and `src/testing`                 |
| `<feature>/index.ts`         | web       | API queries and operations, lookups, hooks and pure helpers — never screens or editors | Other features                          |

An entry exports what other features actually use. Adding an export is a deliberate API change: make sure the consumer depends in the direction of the existing graph, and prefer a service operation or read query to exposing internals. Inside a feature, including its sub-features such as `fabric-catalog/colors`, files import each other freely.

Presenters, controllers, repositories, screens and editors are private by default. Two presenters are deliberate exceptions: `presentWorkOrder` and `presentWorksheet` produce the shared response contracts that allocations and production embed.

## Rules

- **Data.** A repository may read another feature's tables for its own queries, and a table may reference another feature's table, but a feature writes only its own tables. Repositories, tables and persistence helpers import other features only through `tables.ts`: the unit of work loads every repository, and every service imports the unit of work, so a repository that loaded another feature's `index.ts` would close an import cycle.
- **Effects.** Changing another feature's state or starting its workflow goes through that feature's service. A service that coordinates a workflow across features passes the current unit-of-work context explicitly, as described in [unit of work](unit-of-work.md).
- **Unit-of-work repositories.** `UnitOfWorkContext` holds every feature's repository for one transaction; a service uses only its own feature's entries in it.
- **Dependency direction.** Features that depend on each other's `index.ts` must form a directed acyclic graph. Table reads and foreign keys may point either way and are not part of that graph. When two features would need each other, extract the shared concept upward rather than importing in a cycle: whole-order cancellation, which coordinates allocations and work orders, is its own `work-order-cancellation` feature.
- **Web composition.** When a screen shows another feature's UI, it takes that section as a slot prop and its route composes the two, as the order, allocation, stock and receipt detail routes do. Routes in `app/` may import feature screens directly. `components/` and `lib/` import no feature, except the dashboard shell in `components/layout`, which uses the session through `auth`'s entry. Shared UI moves to `components/` once it takes its data as props, as `components/records` and `components/corrections` do.

## Exceptions

- `src/unit-of-work/unit-of-work-context.ts` imports every feature's repository to build the transaction context.
- Web routes (`apps/web/src/app`) import screens directly, because they are the composition layer.
- Tests import other features through `index.ts`, `tables.ts` and `testing/index.ts`, and are exempt from the data rules; shared setup follows [testing](testing.md).

## Enforcement

`npm run check:boundaries` runs [`scripts/check-boundaries.mjs`](../scripts/check-boundaries.mjs) in the CI static job. Using each workspace's TypeScript configuration, it reports:

- deep imports into another feature, and `testing` entries used outside tests;
- API data-layer files that import another feature's `index.ts`;
- shared web components or utilities that import a feature;
- cycles among features' `index.ts` dependencies, and runtime import cycles between files;
- `insert`, `update` or `delete` calls on another feature's table, and use of another feature's repository from the unit-of-work context.

The check reads code structure, so it cannot see writes made in raw SQL, module paths in `vi.mock`, or type-only `import()` expressions. Review those by hand.
