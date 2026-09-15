# Stock receipts

Stock receipts record fabric that has arrived. The purchase-order number is a reference to supplier paperwork; it is not the receipt identity. Submission saves a receipt and creates each physical roll in one database transaction. There is no draft, update, or delete workflow.

Apply `0006_add_stock_receipts.sql` and `0007_add_stock_receipt_idempotency.sql` before running the API or database integration tests.

## Endpoints and permissions

| Method | Path                      | Result                                                         |
| ------ | ------------------------- | -------------------------------------------------------------- |
| POST   | `/api/stock-receipts`     | 201, saved receipt with lines and created stock IDs            |
| GET    | `/api/stock-receipts`     | 200, paginated receipt summaries                               |
| GET    | `/api/stock-receipts/:id` | 200, receipt with lines and current details of its stock items |

All three endpoints require an active signed-in user; user, admin, and owner roles can submit and read receipts. POST requires the configured Origin and an `Idempotency-Key` header containing a UUID. The server derives the submitting user from the authenticated request and sets the submission timestamp. Global rate limits apply. These permissions do not grant users access to admin stock maintenance endpoints.

## Submission

```json
{
  "purchaseOrderNumber": "PO-12345",
  "items": [
    {
      "fabricColorId": "11111111-1111-4111-8111-111111111111",
      "widthMm": 2000,
      "initialLengthMm": 50000,
      "quantity": 5,
      "locationId": "22222222-2222-4222-8222-222222222222"
    }
  ]
}
```

Purchase-order numbers are trimmed and must contain 1–50 characters. Each line requires a valid fabric color and destination location, positive width, and positive initial length **per roll**. Dimensions are JSON numbers in millimetres with at most three decimal places, up to 999,999,999.999. Quantity is a positive integer defaulting to 1. A request must contain 1–100 lines and no more than 1,000 rolls in total. Unknown fields, including submitting-user overrides and stock-state fields, are rejected.

The example creates one receipt, one line, and five individually identified stock items. Received rolls start unused, are not remnants, and have null tube diameter, depth, measurement thickness, source reference, and consumed timestamp. Their initial remaining length is the supplied length. Rolls with different dimensions or destinations belong on separate lines.

The receipt response contains `id`, `purchaseOrderNumber`, `submittedByUserId`, `submittedAt`, and `items`. Each item contains its saved line fields, `id`, `stockReceiptId`, and `stockItemIds`. Lines and stock IDs have stable UUID ordering. GET detail additionally includes each line's `stockItems` array using the shared stock response contract; those stock details reflect subsequent cutting and movements. Receipt dimensions and locations preserve the original delivery.

## Idempotency and transactions

Generate a new UUID key for each intended submission. Retain that key and the submitted payload until the outcome is known, and reuse both after a connection failure. Keys are scoped to the submitting user and retained with the receipt without automatic expiry.

Concurrent requests using the same key are serialized by a database unique index. The first successful transaction creates the receipt and rolls. A retry with the same normalized payload returns the same saved receipt and stock IDs with 201, including after stock measurements have changed. Reusing the key with different content returns 409. Object-property order, trimmed purchase-order-number whitespace, UUID letter case, and omitted versus explicit quantity 1 do not change the normalized request; changing the sequence of lines does.

The idempotency key and request hash are internal and are not returned by the API. Legacy receipts may have both columns null; all API submissions supply both. A different key represents a new submission: purchase-order numbers are references and are not unique. Separate deliveries can reference the same purchase-order number, so a different key can create another receipt for it.

The stock-receipt service coordinates the transaction and owns receipt writes. It calls `StockItemsService.receiveRolls` with that same transaction; stock creation remains owned by the stock-items module. A failure rolls back the header, lines, and stock together, allowing the same key to be retried. No events, background jobs, or separate stock transactions are involved. Lock waits are bounded at five seconds and SQL statements at fifteen seconds.

## Reads, corrections, and errors

Lists accept `search` (a literal, case-insensitive purchase-order-number substring), `page` (default 1), and `pageSize` (default 25, maximum 100). Results sort newest first by submission time and UUID and return `{ items, total, page, pageSize }`. A summary includes the receipt header without its lines or idempotency fields. Reads use a consistent database snapshot for lists/counts and receipt/stock details.

Submitted receipts have no editing or deletion endpoints. Admins can still correct stock measurements and locations through stock CRUD; those corrections do not change receipt lines. Stock linked to a stock-receipt line cannot be hard-deleted through the API (409). Use `consumedAt` to record exhausted material. The stock-receipt reference is read-only in stock CRUD, and opening stock and remnants may leave it null.

Malformed bodies, query parameters, IDs, or missing/invalid idempotency keys return 400. Missing receipts or references return 404. Unauthenticated requests return 401; inactive users or untrusted write origins return 403. Conflicting key reuse returns 409. Storage failures return a generic 503 without exposing database errors. Receipts and stock roll back together when submission fails.

The integration suite uses copies of the migrated tables and real Redis sessions. It verifies permissions, CORS preflight, limits, defaults, quantity expansion, live stock details, stable replays, concurrent submissions, conflicting keys, search/pagination, deletion protection, and rollback after a failure following stock insertion. Tests do not run migrations.
