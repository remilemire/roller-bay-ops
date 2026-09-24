# Station production and digital cutting

Production follows allocated → scheduled → cut → assembled → checked → shipped. Allocation is required before recording production; scheduling and every production milestone are independent and optional. Recording a later milestone never invents earlier completions. The headline status is the furthest recorded step. Each completion covers the whole order; partial quantities are not supported.

## Set up the stations

1. In **Stations → Manage employees**, an admin adds each employee's full name and initials. Optional account links connect an employee to an existing application user; employees do not need their own login. Names and initials need not be unique: the permanent employee ID identifies the person. Deactivate departed employees instead of deleting them.
2. Sign in on each iPad with an eligible Microsoft work account. New accounts start pending. In **Users**, an admin chooses **Change role**, selects **Production**, and assigns cutting, assembly, checking, shipping, or a combination. Assign each dedicated floor iPad only its own station; the server rejects completions for unassigned stations.
3. The production account opens **Stations**, selects the employee who completed the work, finds the order, and records its completion. Single-station accounts open their station directly, with no switching control. Accounts with multiple stations, including staff, first choose a station; a missing or unassigned station in the URL asks again rather than opening another. From a station they use **Change station**, choose a destination, and explicitly confirm the switch before it takes effect. Switching clears the employee selection and order filters. **Queue**, **Completed today**, and **All allocated orders** support regular work and skipped steps. Searching also finds already processed orders. Lists refresh every ten seconds.

A production session is a normal authenticated application account with restricted permissions. The server checks its current role and station assignments on every request. Production accounts can view the relevant production screens, read the active employee picker, record completions, and change their personal display settings. Cutting accounts can read instructions and locations and save/submit worksheets. They cannot manage employees, users, orders, allocations, stock, or office review. Other business endpoints deny production accounts even if the screen is bypassed.

Employee selection records trusted attribution, like the old initials entry; it does not authenticate that individual. Every completion records both the credited employee and the authenticated account that entered it. Selection stays in memory until changed, and clears on reload, logout or station change. Opening a begun cutting sheet selects the employee who began it unless someone is already selected. Names and initials are copied into history, so renaming or deactivating someone does not rewrite previous work.

## Paperless cutting

Open an order at the cutting station and choose **Begin cutting**. This captures the allocation, cutting rules, stock details, dimensions and plan as a permanent worksheet snapshot. It freezes that allocation against replanning and cancellation. The original instructions remain readable after reconciliation. An admin may abandon an unused worksheet with a reason, provided production has not been recorded and no later worksheet depends on it.

The worksheet has cut checkboxes, instructions, return measurements, locations and retained-remnant entry. **Save progress** persists incomplete inputs and checkmarks. **Mark cut** records the whole-order milestone immediately and independently of measurements. **Review and submit results** sends finished measurements to the office without modifying stock. Submitting results does not automatically mark the order cut.

In **Stations → Review cutting results**, an admin opens submissions and accepts them to reconcile inventory. Reconciliation applies the existing allocation completion rules, creates retained remnants and releases reservations atomically. It never writes production timestamps. A submission can be returned for correction with a reason. Admins can explicitly resolve a stock discrepancy using verified measurements and a reason; original submissions remain in the audit records. Review every measurement and its place in the cutting sequence before resolving a discrepancy.

Worksheets sharing a roll are sequenced under stock locks. A cutter must submit the preceding worksheet before starting another on that roll. The office must reconcile them in physical cutting order. Stock revisions may advance automatically only through the recorded, reviewed predecessor. An unrelated stock change blocks normal review rather than silently replacing a newer balance. Review requests require a UUID idempotency key. Exact retries return the accepted sheet; a different request after review is rejected instead of claiming its measurements were applied. Duplicate reviews do not create duplicate remnants. An explicit physical resolution breaks automatic revision propagation to already captured successors: each successor must resolve its discrepancy before its historical observations can affect current inventory.

The station requires a connection. Saved progress survives reload; unsaved edits do not. Failed saves retain the open form, and leaving dirty work prompts for confirmation. The app does not provide an offline synchronization queue.

## Corrections and historical data

The order detail's production panel shows milestone times and employee attribution. Admins can correct the credited employee/time or clear an erroneous milestone, with an expected revision and reason. Later milestones remain unchanged. Completions and corrections use UUID idempotency keys and audit events in the same transaction as the effective order change.

Migrations 0030 and 0031 preserve existing records and timestamps. Historical cutting and shipping timestamps remain visible without invented employee attribution. New assembled/checked timestamps start empty, employees and worksheets start empty, and existing accounts retain their roles. Inventory reconciliation no longer stamps an order as cut. Shipping is recorded through production, not the work-order PATCH endpoint.

## API and ownership

All paths below have the `/api` prefix. Mutations require the configured Origin. Shared contracts live in `@roller-bay/shared/production` and `@roller-bay/shared/employees`.

| Route                                                | Purpose / access                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /production/employees`                          | Active employee picker; assigned production account or staff                                      |
| `GET /production/:station/orders`                    | Station queue, completed-time range or all allocated orders; assigned production account or staff |
| `GET /production/orders/:id/completions`             | Effective employee attribution; assigned production account or staff                              |
| `POST /production/:station/orders/:id/complete`      | Whole-order completion with `employeeId`; UUID `Idempotency-Key`                                  |
| `POST /production/:station/orders/:id/corrections`   | Admin correction with employee/time (or both null), reason, revision and UUID key                 |
| `GET, POST /production/cutting/orders/:id/worksheet` | Read or begin a saved sheet; GET returns 204 when the order has no live sheet; cutting access     |
| `GET /production/cutting/worksheets/:id`             | Read saved sheet; cutting access                                                                  |
| `PUT /production/cutting/worksheets/:id/draft`       | Save partial form and checkmarks with expected revision; cutting access                           |
| `POST /production/cutting/worksheets/:id/submit`     | Submit measurements and optional current draft with expected revision; cutting access             |
| `GET /production/cutting/worksheets`                 | Admin review queue                                                                                |
| `POST /production/cutting/worksheets/:id/review`     | Admin inventory reconciliation; UUID key, expected revision, optional explicit resolution         |
| `POST /production/cutting/worksheets/:id/return`     | Admin return for correction; revision and reason                                                  |
| `POST /production/cutting/worksheets/:id/abandon`    | Admin abandon unused sheet; revision and reason                                                   |
| `GET, POST /employees`                               | Admin employee directory and creation                                                             |
| `PUT /employees/:id`                                 | Admin update/deactivate; expected revision                                                        |

`production` owns the completion table, attribution, corrections and station read model. Its controller delegates to `ProductionService`; its injected repository returns records, and its presenter formats public responses. Work orders own the order and scheduling. Production updates the existing order timestamp projection through `WorkOrdersService` inside the completion transaction; no duplicate order type is introduced. The station-to-timestamp mapping lives in the work-order milestone definitions, not in a repository.

`cutting-worksheets` owns its table, saved instructions, draft/submission state, sequence rules and audit changes. Its injected repository only queries that feature's table. `CuttingWorksheetsService` has no dependency on allocations, work orders or stock services. Allocations calls worksheet service guards for planning, cancellation and reconciliation; it never inspects worksheet rows itself.

`CuttingWorkflowService` coordinates beginning, abandoning and reviewing sheets through allocation, work-order, stock and worksheet services. One explicit transaction crosses those calls; its lock order is allocation, order when needed, worksheet, then stock sorted by ID. Allocations owns fabric plans and reconciliation; stock items owns stock mutation rules. Employees is a separate directory, and users remains the authentication identity.

Repositories are injected. New production/worksheet methods receive the active transaction explicitly; the existing allocation repository binds itself internally when joining a transaction. Controllers do not call repositories, and repositories do not import services or response presenters. These ownership changes move TypeScript files without renaming or recreating database tables.

## Validation

`production.integration.test.ts` uses disposable PostgreSQL/Redis fixtures and covers restricted production access, assignment checks, Origin checks, active employees, allocation prerequisites, late/skipped stages, timestamps, historical attribution, corrections, concurrent retries, sheet freezing, draft persistence, stock sequencing, double review, abandonment and explicit discrepancy resolution. The full API suite verifies existing routes and workflows too.

`production.spec.ts` exercises station navigation, unscheduled completion, directory maintenance and a digital cutting/review workflow on desktop and tablet. It verifies saved checkmarks and measurements survive reload and unsaved edits can be discarded. Browser tests use intercepted API responses; they do not prove Microsoft sign-in or physical iPad behavior.

## Cancelled orders and skipped cutting results

Order cancellation, allocation cancellation and unscheduling have separate controls; see [work orders](work-orders.md#cancellation-and-scheduling-actions). Production facts remain recorded. Cancelled orders are excluded from station queues and cannot receive new production completions, while admins may still correct historical attribution. Removing a fabric plan can preserve already-recorded milestones without leaving an active allocation.

A worksheet closed with `skipped_at` is neither abandoned nor reviewed. Its saved content remains readable, but it cannot be edited, submitted, returned or reconciled and is excluded from the review queue. New cutting can continue with released stock; dependent worksheet review must explicitly resolve the missing measurement baseline. Skipping never updates stock measurements.
