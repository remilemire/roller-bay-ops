# Work orders API

A work order is the one definition of a production order: its number, its note, its blinds, and how far it has progressed. An [allocation](allocations.md) is how fabric is assigned to it and the schedule is when it ships; neither defines it. Fabric is required when setting or changing a ship date. Later allocation cancellation preserves the promised date and flags the order as needing fabric; the week and month calendars are views of the orders that have one. `work_orders` holds one row per six-digit production order number (0–9, leading zeros kept). It is unrelated to the supplier `purchaseOrderNumber` on stock receipts.

The slice lives in `apps/api/src/features/work-orders/`; its contracts are `@roller-bay/shared/work-orders`.

## Steps and status

The status is derived from the furthest reached step and is never stored. Cancellation takes precedence over preserved production milestones:

| Status      | Reached when                 | Column                      |
| ----------- | ---------------------------- | --------------------------- |
| `new`       | Order created                | `created_at`                |
| `allocated` | Allocation confirmed         | `allocated_at`              |
| `scheduled` | Ship date assigned           | `ship_date`, `scheduled_at` |
| `cut`       | Cutting completion recorded  | `cut_at`                    |
| `assembled` | Assembly completion recorded | `assembled_at`              |
| `checked`   | Checking completion recorded | `checked_at`                |
| `shipped`   | Shipping completion recorded | `shipped_at`                |
| `cancelled` | Work order cancelled         | `cancelled_at`              |

Allocation is required before scheduling or recording production. Every later step can be skipped: an unscheduled order can be cut, assembled, checked or shipped. A later completion does not populate earlier timestamps. Setting a ship date stamps `scheduled_at` once; moving the date keeps it, and clearing the date clears it. Production timestamps and attribution are owned by the [station production workflow](production.md), independently of allocation inventory reconciliation. Admin corrections can amend or clear a milestone without affecting later steps. Legacy timestamps remain intact without fabricated employee attribution.

## Blinds

An order's blinds are rows of `work_order_lines`: a fabric color, finished width and drop in millimetres (thousandths kept), and a quantity. Every field is required, in the contract and as `NOT NULL` columns with positive checks, so a half-entered blind stays in the form rather than being saved.

`PUT /api/work-orders/:id/lines` takes `{ expectedRevision, lines }`, the whole list in order, and returns the order with its blinds. **A saved blind never changes and is never deleted**, because a plan's cuts point at the blinds they were made for:

| The list…                       | Result                                        |
| ------------------------------- | --------------------------------------------- |
| keeps an id, values unchanged   | Kept; only its position may change            |
| keeps an id with changed values | 400 `line_immutable` on `lines.<index>`       |
| adds an unknown id              | Inserted; ids are client-generated UUIDs      |
| leaves out a saved id           | Retired (`retired_at`), and left out of reads |
| brings back a retired id        | 400 `line_retired` on `lines.<index>`         |

So a changed blind arrives under a new id, and a cancelled or completed allocation goes on showing the blinds it was planned for. Saving blinds writes only the order's rows: nothing outside the order is touched, and a plan that still points at a retired blind fails its own validation.

An id identifies one blind across all orders (`line_id_in_use`, 400), and an unknown fabric color returns 404 (`fabric_color_not_found`); the foreign key cannot say which blind. The blinds are fixed while the order has a live allocation: the save returns 409 with an issue on `lines` (`order_allocated`). A save locks the order row, checks `expectedRevision`, and increments the order's revision, so two saves serialize and the second is refused as stale. It is recorded as `order.lines-saved`, the one event whose snapshots carry the blinds.

## Allocations

`allocations.work_order_id` references `work_orders.id` (`ON DELETE RESTRICT`), so [allocations](allocations.md) and their drafts can only name an order that exists, and they plan its [blinds](#blinds) rather than blinds of their own. An order with a live allocation cannot be deleted; see [Deleting and restoring](#deleting-and-restoring). An order has at most one live allocation; a completed allocation remains live until explicitly released through allocation cancellation or whole-order cancellation.

**Creating an order and allocating it are separate requests, however close together they happen.** An allocation request never creates an order or changes its number, note, ship date or blinds; the allocation editor's "Create order" is a `POST /api/work-orders` of its own, sent when that option is chosen, and its blinds are saved by a `PUT …/lines` of their own. What an allocation request does write is listed below, and nothing else crosses the boundary: work orders write no allocation table, there are no cascades, and no trigger touches the work-order tables.

The allocation workflow stamps the order inside its own transaction through named `WorkOrdersService` methods, and the order's change is recorded on the allocation's own audit event; these columns are not writable through the endpoints below. Confirming locks the order's row and reads its blinds under that lock, the same lock a save of the blinds takes, so a plan is never confirmed for blinds that were changing under it; an order with no blinds is refused (`order_has_no_lines`).

| Allocation event                 | Order                                                 |
| -------------------------------- | ----------------------------------------------------- |
| Confirmed (created or submitted) | `allocated_at` = the allocation's `confirmed_at`      |
| Replanned                        | Nothing: the allocation stays with its order          |
| Cancelled                        | `allocated_at` cleared; date and production preserved |
| Completed                        | Nothing: inventory reconciliation only                |

**Allocation cancellation preserves an existing ship date.** The narrow allocation-cancel route still refuses recorded production or an active worksheet. Admins use reviewed allocation cancellation to resolve or explicitly skip outstanding results. Releasing completed allocations retains their inventory effects. The order remains open, and a scheduled order without fabric is flagged in detail, list, week and month views.

`allocated_at` follows allocation confirmation; production timestamps are independent. Replanning also refuses recorded production or an active cutting worksheet. Retried requests that replay an earlier result stamp nothing. Confirming an allocation for an order that already has one, or that has shipped, returns 409 with an issue on `workOrderId` (`order_already_allocated`, `order_shipped`); completed allocations still count until explicitly released, so a second allocation requires reviewed allocation cancellation.

Confirmation and narrow cancellation stamps do not increment the order's `revision`; reviewed cancellation, production completions and corrections do. They write columns no edit touches and the row lock serialises them against edits, so allocating fabric never makes an admin's open edit stale. Rows are locked `FOR NO KEY UPDATE`: an allocation's foreign key already holds a key-share lock on its order, and two requests upgrading to `FOR UPDATE` would deadlock instead of letting the second wait and receive the 409. Allocation writes lock the allocation header, then the order, then stock.

## Endpoints

| Method | Path                           | Access       |
| ------ | ------------------------------ | ------------ |
| GET    | `/api/work-orders`             | Signed in    |
| GET    | `/api/work-orders/:id`         | Signed in    |
| GET    | `/api/work-orders/:id/history` | Signed in    |
| POST   | `/api/work-orders`             | Signed in    |
| PATCH  | `/api/work-orders/:id`         | Admin, owner |
| PUT    | `/api/work-orders/:id/lines`   | Signed in    |
| DELETE | `/api/work-orders/:id`         | Admin, owner |

Station accounts use the dedicated production endpoints and cannot access these general order routes. Mutations require the configured Origin header. Global API rate limits apply. Unknown body or query fields are rejected.

POST accepts `orderNumber` and an optional `note`; an order is created without a ship date or blinds. Employees create the orders they allocate fabric for, but a note stays with admins: a non-admin who sends one gets 403 rather than having it dropped. The order number is trimmed and must be exactly six digits; it is unique and cannot be changed afterwards, so a mistyped order is deleted and added again. Notes are trimmed and limited to 1,000 characters; a blank note is stored as null.

PATCH requires `expectedRevision` and at least one of `shipDate` or `note`. `shipDate` is a calendar date (`YYYY-MM-DD`) with no time or timezone, stored in a `date` column, or null to take the order off the schedule, which changes nothing else. It must fall on a weekday: Saturdays and Sundays are rejected with 400 (`Must be a weekday.`). The shared `shipDateSchema` supplies the field message, and the `work_orders_ship_date_weekday` check constraint holds the same rule for writes that bypass the API. An omitted note is left alone; a blank or null note clears it. DELETE takes `{ expectedRevision }` in its body and returns 204.

`GET /api/work-orders/:id` and the blinds save return the order with `lines`; lists and the other writes return it without. Records include `id`, `orderNumber`, `shipDate` (null until scheduled), `quantity` (the total of the order's current blinds, derived on every read and never stored, so zero until blinds are entered), `note`, `status`, `createdAt`, `scheduledAt`, `allocatedAt`, `cutAt`, `assembledAt`, `checkedAt`, `shippedAt`, `updatedAt`, and `revision`.

## Deleting and restoring

Deleting an order sets `deleted_at` and keeps the row. A foreign key can only reference a fully unique column, so the order number stays unique across deleted orders too, and cancelled allocations and old drafts go on referencing it. A deleted order is left out of lists, lookups by ID, the allocation picker, and milestone stamps, so it answers 404 and does not exist for new work: confirming an allocation for it, or saving a draft that names it, returns the usual `order_not_found` error. Its history stays readable.

A live allocation or recorded production blocks deletion: DELETE returns 409 (`Use order cancellation to retain the production history.`). Orders with recorded production must use cancellation even after their fabric is released. Cancelled allocations and drafts do not block it, and a remaining ship date also blocks deletion. The check and the delete happen under the order's row lock, so an allocation cannot confirm in between, and a check constraint keeps a deleted order from holding `allocated_at`.

POST with a deleted order's number restores that order instead of reporting a duplicate: same `id`, `created_at` and blinds, the new note, `shipped_at` cleared, and the next revision. It is recorded as `order.restored`. Only an admin restores: an employee naming a deleted number gets 409 (`order_deleted`), so creating orders cannot undo an admin's delete. A number held by an order that still exists returns the usual 409 (`order_already_exists`).

## Lists

Lists return `{ items, total, page, pageSize }` and accept `page` (default 1), `pageSize` (default 25, maximum 100), `search`, `status`, `shipDateFrom`, and `shipDateTo`. Search is a case-insensitive literal substring of the order number. `status` is one of the eight statuses, `open`, which lists every order that has not shipped or been cancelled, or `unscheduled`, the queue of allocated orders (cut or not) still waiting for a ship date. `shipDateFrom` and `shipDateTo` are inclusive calendar-day bounds (`YYYY-MM-DD`) that the week and month views use. A ship-date bound leaves out orders with no date. Orders sort by ship date, undated last, then order number; page data and totals use the same database snapshot.

## Concurrency and errors

An edit locks the row, compares `expectedRevision`, and increments `revision`; a delete checks the revision in the `DELETE` itself. A stale revision returns 409 (`Order changed; refresh before saving.`). A duplicate order number returns 409 with an issue on `orderNumber`, including when two requests race. Missing and deleted orders return 404, invalid input returns 400, and storage failures return a generic 503. Lock waits are limited to five seconds and surface as a 409.

## History

Creating, restoring, editing, scheduling, unscheduling and deleting record transactional audit events. Allocation confirmation/cancellation attach the order's allocation-stamp change to their own event. Allocation inventory completion no longer changes the order. Digital worksheet submission records cutting completion atomically; returned measurements preserve that completion. Production completion and correction record `order.<station>.completed` / `order.<station>.corrected` with both work-order and employee-attribution snapshots. Order history also includes allocation replanning, inventory completion and corrections, and all recorded cutting worksheet events. Events touching several related records appear once; the same relationship-based lookup includes existing history without rewriting audit records. Order history therefore shows the authenticated actor, credited employees, timestamp changes and correction reason. Older audit events remain readable with absent assembled/checked timestamps treated as null.

## Tests

`work-orders.integration.test.ts` runs in its own throwaway database ([testing](testing.md)) and covers role and Origin checks, validation, duplicate and concurrent creation, revision conflicts, scheduling only after allocation through the API, clearing a date, shipping, history, deletion and restoring, status and queue filters, literal search, ordering, and pagination. `migrations.integration.test.ts` applies migration 0028 over rows as they were, since every other suite starts from an empty database: it checks each guard stops the migration, where the blinds land, and that every cut still points at its blind. The allocation cases cover unknown, empty, deleted and already-allocated orders, plans that assign another order's blinds, that allocation requests never create or edit an order, a save of the blinds racing a confirmation, cancelling an allocation while preserving the order's ship date, a cancelled allocation keeping its blinds after the order's change, a draft losing a retired blind's assignment, concurrent allocation of one order, shared draft numbers, allocation confirmation stamps and production independent of inventory completion, moving and cancelling, shipped orders, blocked deletion, and the attached history. `work-order-lines.integration.test.ts` covers keeping, adding, reordering and retiring blinds, immutability and retired ids, validation, unknown colors, ids held by another order, stale and racing saves, allocated and deleted orders, employee access, and the recorded history. Unit tests cover the contracts, status derivation, and driver-error mapping.

## Cancellation and scheduling actions

The UI exposes separate actions:

- **Unschedule** in the scheduling controls clears `ship_date` and `scheduled_at`; it leaves fabric reservations and production intact.
- **Cancel allocation** on the allocation releases reservations and clears the order's `allocated_at`. The order stays open and its existing date remains. A scheduled order without an allocation displays **Needs fabric allocation**. New scheduling/rescheduling still requires an allocation; clearing a date or editing a note does not.
- **Cancel work order** on the order releases its allocation and clears its date, then records `cancelled_at` and a reason. Cancelled orders stay readable and appear in the Cancelled/All lists; new allocation, scheduling, blind edits and production completion are refused.

Order cancellation uses `GET /api/work-orders/:id/cancellation-context` and `POST /api/work-orders/:id/cancellation`. Reviewed allocation cancellation uses the equivalent paths under `/api/allocations/:id`. Each POST takes a required reason, preview order/allocation/worksheet IDs and revisions, and `skipCuttingResults`; there is no action selector. Both reviewed operations are admin-only and require a UUID `Idempotency-Key`. Exact retries replay; changed payloads conflict. The narrow staff allocation-cancel route remains available for active allocations without production or worksheets.

Active allocations receive `cancelled_at`; completed allocations receive `released_at` and retain completion and inventory effects. Another allocation can then be created for the same order. Original plans, production timestamps and employee attribution survive. Shipped orders cannot be cancelled or released. Delete is for unused, unscheduled orders. Order-number reuse does not restore a cancelled order.

When cutting has started or production has been recorded without inventory reconciliation, cancellation requires resolving results first or explicitly setting `skipCuttingResults`. Skipping closes the worksheet with `skipped_at`, preserves drafts and submissions, releases reservations, and makes **no stock measurement writes**. The audit action ends in `.results-skipped`, including paper cutting without a worksheet. The form warns that available stock may be overstated. Later worksheets that depend on a skipped observation require explicit discrepancy resolution.

The cancellation dialog preserves input on conflicts, reloads current details, resets the skip acknowledgement and requires another review. Unknown network outcomes keep the original request and key for retry. A permanent refresh button is not part of the normal form.

`WorkOrderCancellationService` exists because allocations already depend on core work orders. It lives in its own `work-order-cancellation` feature, which depends on both, so whole-order cancellation is coordinated without a dependency cycle. Allocation cancellation owns worksheet closure and fabric release in `AllocationsService`; scheduling remains an order date operation. Both cancellation paths retain allocation → order → worksheet → sorted-stock locking and one transaction for state, audit and idempotency.

Migration 0034 removes the state-wide `ship_date`/allocation constraint: a retained promise without fabric is now valid. Scheduling eligibility remains enforced under the order lock in the service. Existing dates and records are not rewritten.
