# Order schedule API

The order schedule lists production orders with their ship dates and how far each has progressed. `scheduled_orders` holds one row per six-digit production order number (0–9, leading zeros kept). It is unrelated to the supplier `purchaseOrderNumber` on stock receipts.

The slice lives in `apps/api/src/features/order-schedule/`; its contracts are `@roller-bay/shared/order-schedule`.

## Milestones and status

Each order carries four milestone timestamps. The status is derived from the furthest one reached and is never stored:

| Milestone      | Status      | Set by                                        |
| -------------- | ----------- | --------------------------------------------- |
| `scheduled_at` | `scheduled` | Adding the order; doubles as its created time |
| `allocated_at` | `allocated` | Not writable through these endpoints          |
| `cut_at`       | `cut`       | Not writable through these endpoints          |
| `shipped_at`   | `shipped`   | `shipped: true` on PATCH; `false` clears it   |

Shipping is not gated on cutting, and a shipped order reports `shipped` whatever its other milestones. The server owns every timestamp; marking a shipped order shipped again keeps the original time. A check constraint keeps `cut_at` from being set without `allocated_at`.

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

POST accepts `orderNumber`, `shipDate`, and an optional `note`. The order number is trimmed and must be exactly six digits; it is unique and cannot be changed afterwards, so a mistyped order is deleted and added again. `shipDate` is a calendar date (`YYYY-MM-DD`) with no time or timezone, stored in a `date` column. Notes are trimmed and limited to 1,000 characters; a blank note is stored as null.

PATCH requires `expectedRevision` and at least one of `shipDate`, `note`, or `shipped`. An omitted note is left alone; a blank or null note clears it. DELETE takes `{ expectedRevision }` in its body and returns 204.

Records include `id`, `orderNumber`, `shipDate`, `note`, `status`, the four milestone timestamps, `updatedAt`, and `revision`.

## Lists

Lists return `{ items, total, page, pageSize }` and accept `page` (default 1), `pageSize` (default 25, maximum 100), `search`, and `status`. Search is a case-insensitive literal substring of the order number. `status` is one of the four statuses or `open`, which lists every order that has not shipped. Orders sort by ship date, then order number; page data and totals use the same database snapshot.

## Concurrency and errors

Every edit and delete locks the row, compares `expectedRevision`, and increments `revision`. A stale revision returns 409 (`Order changed; refresh before saving.`). A duplicate order number returns 409 with an issue on `orderNumber`, including when two requests race. Missing orders return 404, invalid input returns 400, and storage failures return a generic 503. Lock waits are limited to five seconds and surface as a 409.

## History

Adding, editing, shipping, unshipping, and deleting are recorded through the [audit service](corrections-and-audit.md) in the same transaction, as `order.scheduled`, `order.updated`, `order.shipped`, `order.unshipped`, and `order.deleted`. Snapshots use the public order record under the `order-schedule` record type.

## Setup and tests

Apply `0019_add_order_schedule.sql` before using the endpoints or running integration tests. No orders are seeded.

The [auth integration suite](authentication.md#tests) copies `scheduled_orders` into its disposable schema and covers role and Origin checks, validation, duplicate and concurrent creation, revision conflicts, shipping, history, status filters, literal search, ordering, and pagination. Unit tests cover the contracts, status derivation, and driver-error mapping.
