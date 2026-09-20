# Order schedule API

The order schedule lists production orders with their ship dates and how far each has progressed. `scheduled_orders` holds one row per six-digit production order number (0–9, leading zeros kept). It is unrelated to the supplier `purchaseOrderNumber` on stock receipts.

The slice lives in `apps/api/src/features/order-schedule/`; its contracts are `@roller-bay/shared/order-schedule`.

## Milestones and status

Each order carries four milestone timestamps. The status is derived from the furthest one reached and is never stored:

| Milestone      | Status      | Set by                                        |
| -------------- | ----------- | --------------------------------------------- |
| `scheduled_at` | `scheduled` | Adding the order; doubles as its created time |
| `allocated_at` | `allocated` | Confirming the order's allocation             |
| `cut_at`       | `cut`       | Completing the order's allocation             |
| `shipped_at`   | `shipped`   | `shipped: true` on PATCH; `false` clears it   |

Shipping is not gated on cutting, and a shipped order reports `shipped` whatever its other milestones. The server owns every timestamp; marking a shipped order shipped again keeps the original time. A check constraint keeps `cut_at` from being set without `allocated_at`.

## Allocations

`allocations.order_number` references `scheduled_orders.order_number` (`ON DELETE RESTRICT`), so [allocations](allocations.md) and their drafts can only name scheduled orders, and an order that any allocation or draft names cannot be deleted; the attempt returns 409. Because only admins schedule orders, an order must be scheduled before anyone can allocate fabric for it. An order has at most one live allocation.

The allocation workflow stamps the order inside its own transaction through `OrderScheduleService`; these columns are not writable through the endpoints below.

| Allocation event                   | Order                                                         |
| ---------------------------------- | ------------------------------------------------------------- |
| Confirmed (created or submitted)   | `allocated_at` = the allocation's `confirmed_at`              |
| Replaced onto another order number | Old order's `allocated_at` cleared; new order takes the stamp |
| Cancelled                          | `allocated_at` cleared; the order is `scheduled` again        |
| Completed                          | `cut_at` = the allocation's `completed_at`                    |

So `allocated_at` and `cut_at` always mirror the order's live allocation. Retried requests that replay an earlier result stamp nothing. Confirming or moving an allocation onto an order that already has one, or that has shipped, returns 409 with an issue on `orderNumber` (`order_already_allocated`, `order_shipped`); completed allocations still count, so a recut under the same order number is rejected.

Stamps do not increment the order's `revision`. They write columns no edit touches and the row lock serialises them against edits, so allocating fabric never makes an admin's open edit stale. Rows are locked `FOR NO KEY UPDATE`: an allocation's foreign key already holds a key-share lock on its order, and two requests upgrading to `FOR UPDATE` would deadlock instead of letting the second wait and receive the 409. Allocation writes lock the allocation header, then the order, then stock.

## Endpoints

| Method | Path                              | Access       |
| ------ | --------------------------------- | ------------ |
| GET    | `/api/order-schedule`             | Signed in    |
| GET    | `/api/order-schedule/:id`         | Signed in    |
| GET    | `/api/order-schedule/:id/history` | Signed in    |
| POST   | `/api/order-schedule`             | Admin, owner |
| PATCH  | `/api/order-schedule/:id`         | Admin, owner |
| DELETE | `/api/order-schedule/:id`         | Admin, owner |

Mutations require the configured Origin header. Global API rate limits apply. Unknown body or query fields are rejected.

POST accepts `orderNumber`, `shipDate`, and an optional `note`. The order number is trimmed and must be exactly six digits; it is unique and cannot be changed afterwards, so a mistyped order is deleted and added again. `shipDate` is a calendar date (`YYYY-MM-DD`) with no time or timezone, stored in a `date` column. It must fall on a weekday: Saturdays and Sundays are rejected with 400 (`Must be a weekday.`) on create and on edit. The shared `shipDateSchema` supplies the field message, and the `scheduled_orders_ship_date_weekday` check constraint holds the same rule for writes that bypass the API. Notes are trimmed and limited to 1,000 characters; a blank note is stored as null.

PATCH requires `expectedRevision` and at least one of `shipDate`, `note`, or `shipped`. An omitted note is left alone; a blank or null note clears it. DELETE takes `{ expectedRevision }` in its body and returns 204.

Records include `id`, `orderNumber`, `shipDate`, `note`, `status`, the four milestone timestamps, `updatedAt`, and `revision`.

## Lists

Lists return `{ items, total, page, pageSize }` and accept `page` (default 1), `pageSize` (default 25, maximum 100), `search`, and `status`. Search is a case-insensitive literal substring of the order number. `status` is one of the four statuses or `open`, which lists every order that has not shipped. Orders sort by ship date, then order number; page data and totals use the same database snapshot.

## Concurrency and errors

An edit locks the row, compares `expectedRevision`, and increments `revision`; a delete checks the revision in the `DELETE` itself. A stale revision returns 409 (`Order changed; refresh before saving.`). A duplicate order number returns 409 with an issue on `orderNumber`, including when two requests race. Missing orders return 404, invalid input returns 400, and storage failures return a generic 503. Lock waits are limited to five seconds and surface as a 409.

## History

Adding, editing, shipping, unshipping, and deleting are recorded through the [audit service](corrections-and-audit.md) in the same transaction, as `order.scheduled`, `order.updated`, `order.shipped`, `order.unshipped`, and `order.deleted`. Snapshots use the public order record under the `order-schedule` record type. Milestone stamps are not separate events: the order's before/after change is attached to the allocation's own `allocation.confirmed`, `allocation.replaced`, `allocation.cancelled`, or `allocation.completed` event, so both the allocation's and the order's history show it.

## Setup and tests

Apply `0019_add_order_schedule.sql` before using the endpoints or running integration tests. No orders are seeded.

`0021_require_weekday_ship_dates.sql` adds the weekday check constraint.

`0020_link_allocations_to_order_schedule.sql` adds the foreign key and the one-live-allocation index. It backfills nothing: the schedule starts empty, so the migration aborts, changing nothing, while any allocation or draft still carries an order number. Check first with:

```sql
SELECT is_draft, count(*) FROM allocations WHERE order_number IS NOT NULL GROUP BY 1;
```

The [auth integration suite](authentication.md#tests) copies `scheduled_orders` into its disposable schema and covers role and Origin checks, validation, duplicate and concurrent creation, revision conflicts, shipping, history, status filters, literal search, ordering, and pagination. The allocation cases cover unscheduled and already-allocated orders, concurrent allocation of one order, shared draft numbers, stamps matching the allocation's timestamps, moving and cancelling, shipped orders, blocked deletion, and the attached history. Unit tests cover the contracts, status derivation, and driver-error mapping.
