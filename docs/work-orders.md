# Work orders API

A work order is a production order: its number, its blinds, and how far it has progressed. Fabric is allocated first, to see what is on hand, and the order is given a ship date afterwards; the week and month calendars are views of the orders that have one. `work_orders` holds one row per six-digit production order number (0–9, leading zeros kept). It is unrelated to the supplier `purchaseOrderNumber` on stock receipts.

The slice lives in `apps/api/src/features/work-orders/`; its contracts are `@roller-bay/shared/work-orders`.

## Steps and status

The status is derived from the furthest step reached and is never stored:

| Status      | Reached when                                | Column                      |
| ----------- | ------------------------------------------- | --------------------------- |
| `new`       | The order is created                        | `created_at`                |
| `allocated` | Its allocation is confirmed                 | `allocated_at`              |
| `scheduled` | It is given a ship date                     | `ship_date`, `scheduled_at` |
| `cut`       | Its allocation is completed                 | `cut_at`                    |
| `shipped`   | `shipped: true` on PATCH; `false` clears it | `shipped_at`                |

**An order is scheduled only once it is allocated.** Setting a ship date on an order with no live allocation returns 409 with an issue on `shipDate` (`order_not_allocated`), and the `work_orders_ship_date_requires_allocation` check constraint holds the same rule for writes that bypass the API. `scheduled_at` is when the order went on the schedule: moving the date keeps it, clearing the date clears it, and a check constraint keeps the two in step.

Cutting needs no ship date and outranks one, so an order cut before it is dated reports `cut`. Shipping is not gated on the earlier steps, and a shipped order reports `shipped` whatever else is set. The server owns every timestamp; marking a shipped order shipped again keeps the original time. A check constraint keeps `cut_at` from being set without `allocated_at`.

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

`allocations.order_number` references `work_orders.order_number` (`ON DELETE RESTRICT`), so [allocations](allocations.md) and their drafts can only name an order that exists. An order with a live allocation cannot be deleted; see [Deleting and restoring](#deleting-and-restoring). Only admins create orders, so an order must be created before anyone can allocate fabric for it. An order has at most one live allocation.

An allocation's blinds add up to its order's `quantity`: confirming an allocation, moving it to another order, and replanning it on the same order all compare the total of its requirements' quantities with the order, under the order's row lock. A mismatch returns 400 with an issue on `orderNumber` (`order_quantity_mismatch`) and stamps nothing. Drafts are not checked.

The allocation workflow stamps the order inside its own transaction through `WorkOrdersService`; these columns are not writable through the endpoints below.

| Allocation event                   | Order                                                         |
| ---------------------------------- | ------------------------------------------------------------- |
| Confirmed (created or submitted)   | `allocated_at` = the allocation's `confirmed_at`              |
| Replaced onto another order number | Old order's `allocated_at` cleared; new order takes the stamp |
| Cancelled                          | `allocated_at` cleared; the order is `new` again              |
| Completed                          | `cut_at` = the allocation's `completed_at`                    |

**An allocation cannot be cancelled, or moved to another order, while its order has a ship date.** Both would clear `allocated_at`, which a dated order must keep, so they return 409 with an issue on `orderNumber` (`order_scheduled`) and change nothing; clear the ship date first. Clearing it inside the cancel would change the schedule from a request that never named it. Replanning on the same order releases nothing and keeps the date.

So `allocated_at` and `cut_at` always mirror the order's live allocation. Retried requests that replay an earlier result stamp nothing. Confirming or moving an allocation onto an order that already has one, or that has shipped, returns 409 with an issue on `orderNumber` (`order_already_allocated`, `order_shipped`); completed allocations still count, so a recut under the same order number is rejected.

Stamps do not increment the order's `revision`. They write columns no edit touches and the row lock serialises them against edits, so allocating fabric never makes an admin's open edit stale. Rows are locked `FOR NO KEY UPDATE`: an allocation's foreign key already holds a key-share lock on its order, and two requests upgrading to `FOR UPDATE` would deadlock instead of letting the second wait and receive the 409. Allocation writes lock the allocation header, then the order, then stock.

## Endpoints

| Method | Path                           | Access       |
| ------ | ------------------------------ | ------------ |
| GET    | `/api/work-orders`             | Signed in    |
| GET    | `/api/work-orders/:id`         | Signed in    |
| GET    | `/api/work-orders/:id/history` | Signed in    |
| POST   | `/api/work-orders`             | Admin, owner |
| PATCH  | `/api/work-orders/:id`         | Admin, owner |
| PUT    | `/api/work-orders/:id/lines`   | Signed in    |
| DELETE | `/api/work-orders/:id`         | Admin, owner |

Mutations require the configured Origin header. Global API rate limits apply. Unknown body or query fields are rejected.

POST accepts `orderNumber`, `quantity`, and an optional `note`; an order is created without a ship date. `quantity` is the number of blinds on the order, a whole number from 1 to 1,000,000; it is required, and a check constraint keeps it positive. The order number is trimmed and must be exactly six digits; it is unique and cannot be changed afterwards, so a mistyped order is deleted and added again. Notes are trimmed and limited to 1,000 characters; a blank note is stored as null.

PATCH requires `expectedRevision` and at least one of `shipDate`, `quantity`, `note`, or `shipped`. `shipDate` is a calendar date (`YYYY-MM-DD`) with no time or timezone, stored in a `date` column, or null to take the order off the schedule, which changes nothing else. It must fall on a weekday: Saturdays and Sundays are rejected with 400 (`Must be a weekday.`). The shared `shipDateSchema` supplies the field message, and the `work_orders_ship_date_weekday` check constraint holds the same rule for writes that bypass the API. Changing the quantity of an order that has an allocation returns 409 with an issue on `quantity` (`order_allocated`), because that allocation's blinds were checked against it; cancel or replace the allocation first. Sending the unchanged quantity is accepted. An omitted note is left alone; a blank or null note clears it. DELETE takes `{ expectedRevision }` in its body and returns 204.

`GET /api/work-orders/:id` and the blinds save return the order with `lines`; lists and the other writes return it without. Records include `id`, `orderNumber`, `shipDate` (null until scheduled), `quantity`, `note`, `status`, `createdAt`, `scheduledAt`, `allocatedAt`, `cutAt`, `shippedAt`, `updatedAt`, and `revision`.

## Deleting and restoring

Deleting an order sets `deleted_at` and keeps the row. A foreign key can only reference a fully unique column, so the order number stays unique across deleted orders too, and cancelled allocations and old drafts go on referencing it. A deleted order is left out of lists, lookups by ID, the allocation picker, and milestone stamps, so it answers 404 and does not exist for new work: confirming an allocation for it, or saving a draft that names it, returns the usual `order_not_found` error. Its history stays readable.

Only a live allocation blocks deletion: DELETE returns 409 (`This order has an allocation. Cancel it before deleting the order.`) while `allocated_at` is set, which a completed allocation keeps set. Cancelled allocations and drafts do not block it, and since a dated order keeps its allocation, a deleted order never has a ship date. The check and the delete happen under the order's row lock, so an allocation cannot confirm in between, and a check constraint keeps a deleted order from holding `allocated_at`.

POST with a deleted order's number restores that order instead of reporting a duplicate: same `id` and `created_at`, the new quantity and note, `shipped_at` cleared, and the next revision. It is recorded as `order.restored`. A number held by an order that still exists returns the usual 409 (`order_already_exists`).

## Lists

Lists return `{ items, total, page, pageSize }` and accept `page` (default 1), `pageSize` (default 25, maximum 100), `search`, `status`, `shipDateFrom`, and `shipDateTo`. Search is a case-insensitive literal substring of the order number. `status` is one of the five statuses, `open`, which lists every order that has not shipped, or `unscheduled`, the queue of allocated orders (cut or not) still waiting for a ship date. `shipDateFrom` and `shipDateTo` are inclusive calendar-day bounds (`YYYY-MM-DD`) that the week and month views use. A ship-date bound leaves out orders with no date. Orders sort by ship date, undated last, then order number; page data and totals use the same database snapshot.

## Concurrency and errors

An edit locks the row, compares `expectedRevision`, and increments `revision`; a delete checks the revision in the `DELETE` itself. A stale revision returns 409 (`Order changed; refresh before saving.`). A duplicate order number returns 409 with an issue on `orderNumber`, including when two requests race. Missing and deleted orders return 404, invalid input returns 400, and storage failures return a generic 503. Lock waits are limited to five seconds and surface as a 409.

## History

Creating, restoring, editing, scheduling, unscheduling, shipping, unshipping, and deleting are recorded through the [audit service](corrections-and-audit.md) in the same transaction, as `order.created`, `order.restored`, `order.updated`, `order.scheduled` (a first ship date), `order.unscheduled` (the date cleared), `order.shipped`, `order.unshipped`, and `order.deleted`. Moving a date is `order.updated`. Snapshots use the public order record under the `work-orders` record type. Milestone stamps are not separate events: the order's before/after change is attached to the allocation's own `allocation.confirmed`, `allocation.replaced`, `allocation.cancelled`, or `allocation.completed` event, so both the allocation's and the order's history show it.

## Tests

`work-orders.integration.test.ts` runs in its own throwaway database ([testing](testing.md)) and covers role and Origin checks, validation, duplicate and concurrent creation, revision conflicts, scheduling only after allocation (through the API and against the check constraints), clearing a date, shipping, history, deletion and restoring, status and queue filters, literal search, ordering, and pagination. The allocation cases cover missing and already-allocated orders, cancelling or moving refused while the order has a ship date, concurrent allocation of one order, shared draft numbers, stamps matching the allocation's timestamps, moving and cancelling, shipped orders, blocked deletion, and the attached history. `work-order-lines.integration.test.ts` covers keeping, adding, reordering and retiring blinds, immutability and retired ids, validation, unknown colors, ids held by another order, stale and racing saves, allocated and deleted orders, employee access, and the recorded history. Unit tests cover the contracts, status derivation, and driver-error mapping.
