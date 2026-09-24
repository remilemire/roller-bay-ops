# Unit of work

Services choose which database operations must succeed together. `UnitOfWork` starts the transaction and supplies repositories bound to its connection. Repository methods execute immediately; there is no entity tracking or `saveChanges()` step.

## Connections and construction

`DatabaseService` owns the PostgreSQL pool, health probe, and shutdown. The application composition module in `apps/api/src/unit-of-work` imports `DatabaseModule` and concrete repository classes, never feature services or modules. Feature modules import `UnitOfWorkModule`, so this dependency direction does not introduce a module cycle.

Every PostgreSQL repository takes a `DatabaseExecutor`: the query methods shared by a normal Drizzle database and a transaction, excluding transaction creation. Each feature registers its ordinary repository using a Nest factory provider:

```ts
{
  provide: UsersRepository,
  inject: [DatabaseService],
  useFactory: (database: DatabaseService) =>
    new UsersRepository(database.db),
}
```

`createRepositories(tx)` constructs a fresh set of the same repository classes for each transaction. Constructors perform no queries. Repositories remain in their features; the context only assembles them. Redis sessions and OAuth state are not PostgreSQL repositories and do not participate.

## Choosing a boundary

Use `unitOfWork.transaction(...)` for atomic writes and `unitOfWork.readOnlyTransaction(...)` for a consistent multi-query snapshot. The latter is how paginated lists keep their rows and totals consistent. Both callbacks receive `UnitOfWorkContext`, containing named repositories such as `context.allocations`, `context.stockItems`, and `context.audit`.

Normal injected repositories remain useful for standalone reads and single-statement writes. Multi-statement repository operations such as replacing an allocation plan rely on their service to open the transaction. Repositories never open transactions themselves.

Write transactions explicitly use `read committed` / `read write`. Read snapshots use `repeatable read` / `read only`; PostgreSQL rejects writes through them. Both modes set a transaction-local 5-second lock timeout and 30-second statement timeout. The statement limit applies to each SQL statement, not the entire callback. These settings do not change the pool's defaults or standalone queries.

The unit of work returns a result only after commit. Callback failures and commit failures reject the operation; Drizzle handles rollback and connection release. Feature error translation surrounds the entire unit-of-work call, including commit. Existing typed persistence errors retain their original classification. Transactions are not automatically retried.

## Sharing a transaction across services

Inside the callback, use context repositories exclusively. Pass the context to another service when it must participate in the same transaction:

```ts
await this.unitOfWork.transaction(async (context) => {
  const allocation = await context.allocations.findById(id, true);
  if (!allocation) throw new NotFoundException('Allocation not found.');
  // Validate the allocation before requesting the work-order change.
  await this.orders.release(context, allocation.workOrderId);
  // Continue allocation persistence and audit with the same context.
});
```

`WorkOrderCancellationService` coordinates only whole-order cancellation: allocation release, worksheet closure and the order update share one transaction and one audit event. It is its own feature, `features/work-order-cancellation`, above both work orders and allocations: allocations already depend on work orders, so coordinating from inside work orders would make the two features depend on each other. Allocation cancellation itself belongs to `AllocationsService`; scheduling uses the order's date update.

The receiving service uses its own repository from the context. It continues to own its business rules: allocations request stock effects from `StockItemsService` and order milestones from `WorkOrdersService`.

Context-taking methods require a context and do not open a second transaction. Allocation completion has two actual callers, so `complete(...)` opens a transaction and delegates to `completeInTransaction(context, ...)`; worksheet review calls the latter within its existing transaction. The raw Drizzle transaction is not part of the context.

An injected repository still points at the pool even while a unit of work is running. Context passing is explicit, not ambient: using the injected repository inside the callback would escape the transaction. Never keep contexts on singleton services, return repositories from callbacks, or launch database work without awaiting it. Starting a new unit of work always starts an independent transaction; it does not join an existing one.

## Workflow guarantees

Allocation and receipt graphs stay within their existing repositories. Audit events and idempotency records use the same context as the domain writes. Existing lock modes and order remain intact, including allocation → order → worksheet → sorted stock for cutting workflows. Solver requests run after the planning snapshot has closed.

User administration starts a unit of work, then calls `context.users.lockForAdministration()` before reading or changing ownership. This retains the table lock that protects bootstrap even when no owner exists.

Microsoft profile synchronization intentionally uses separate autocommit queries. `UsersService` retries a named email conflict by updating the existing Microsoft subject through the ordinary repository. A failed SQL statement aborts an explicit PostgreSQL transaction, so putting that retry inside one transaction would break it. Account bootstrap, if needed afterward, uses its own locked unit of work.

HTTP contracts and database schemas are unaffected. Tests and their limits are described in [Testing](testing.md#unit-of-work).
