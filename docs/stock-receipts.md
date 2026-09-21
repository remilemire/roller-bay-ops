# Stock receipts

Stock receipts record fabric that has arrived. The purchase-order number is a reference to supplier paperwork; it is not the receipt identity. Submission saves a receipt and creates each physical roll in one database transaction. Shared drafts allow employees to save incomplete receipts before submission; submitted receipts remain immutable.

The typed-draft schema is introduced by `0010_typed_drafts`.

## Endpoints and permissions

| Method | Path                      | Result                                                         |
| ------ | ------------------------- | -------------------------------------------------------------- |
| POST   | `/api/stock-receipts`     | 201, saved receipt with lines and created stock IDs            |
| GET    | `/api/stock-receipts`     | 200, paginated receipt summaries                               |
| GET    | `/api/stock-receipts/:id` | 200, receipt with lines and current details of its stock items |

All endpoints require an active signed-in user; user, admin, and owner roles can submit and read receipts. POST requires the configured Origin and an `Idempotency-Key` header containing a UUID. The server derives the submitting user from the authenticated request and sets the submission timestamp. Global rate limits apply. These permissions do not grant users access to admin stock maintenance endpoints.

## Submission

```json
{
  "purchaseOrderNumber": "12345",
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

Purchase-order numbers are trimmed and must be exactly five digits (0–9, leading zeros kept). Receipts submitted before this rule may hold other references of up to 50 characters; the database still accepts them. Each line requires a valid fabric color and destination location, positive width, and positive initial length **per roll**. Dimensions are JSON numbers in millimetres with at most three decimal places, up to 999,999,999.999. Quantity is a positive integer defaulting to 1. A request must contain 1–100 lines and no more than 1,000 rolls in total. Unknown fields, including submitting-user overrides and stock-state fields, are rejected.

The example creates one receipt, one line, and five individually identified stock items. Received rolls start unused, are not remnants, and have null tube diameter, depth, measurement thickness, source reference, and consumed timestamp. Their initial remaining length is the supplied length. Rolls with different dimensions or destinations belong on separate lines.

The submitted receipt response includes `state: "submitted"`, creation/update metadata, `revision`, `createdByUserId`, `id`, `purchaseOrderNumber`, `submittedByUserId`, `submittedAt`, and `items`. Each item contains its saved line fields, `id`, `stockReceiptId`, and `stockItemIds`. Receipt lines retain their saved form order; stock IDs use stable UUID ordering. GET detail additionally includes each line's `stockItems` array using the shared stock response contract; those stock details reflect subsequent cutting and movements. Receipt dimensions and locations preserve the original delivery.

## Idempotency and transactions

Generate a new UUID key for each intended submission. Retain that key and the submitted payload until the outcome is known, and reuse both after a connection failure. Creation keys are scoped to the creating user and retained with the receipt without automatic expiry.

Concurrent requests using the same key are serialized by a database unique index. The first successful transaction creates the receipt and rolls. A retry with the same normalized payload returns the same saved receipt and stock IDs with 201, including after stock measurements have changed. Reusing the key with different content returns 409. Object-property order, trimmed purchase-order-number whitespace, UUID letter case, and omitted versus explicit quantity 1 do not change the normalized request; changing the sequence of lines does.

The idempotency key and request hash are internal and are not returned by the API. Legacy receipts may have both columns null; all API submissions supply both. A different key represents a new submission: purchase-order numbers are references and are not unique. Separate deliveries can reference the same purchase-order number, so a different key can create another receipt for it.

The stock-receipt service coordinates the transaction and owns receipt writes. It calls `StockItemsService.receiveRolls` with that same transaction; stock creation remains owned by the stock-items module. A failure rolls back the header, lines, and stock together, allowing the same key to be retried. No events, background jobs, or separate stock transactions are involved. Lock waits are bounded at five seconds and SQL statements at fifteen seconds.

## Reads, corrections, and errors

Lists accept `search` (a literal, case-insensitive purchase-order-number substring), `page` (default 1), and `pageSize` (default 25, maximum 100). Results sort newest first by submission time and UUID and return `{ items, total, page, pageSize }`. A summary includes the receipt header without its lines or idempotency fields. Reads use a consistent database snapshot for lists/counts and receipt/stock details.

Submitted receipts have no editing or deletion endpoints. Admins can still correct stock measurements and locations through stock CRUD; those corrections do not change receipt lines. Stock linked to a stock-receipt line cannot be hard-deleted through the API (409). Use `consumedAt` to record exhausted material. The stock-receipt reference is read-only in stock CRUD, and opening stock and remnants may leave it null.

Malformed bodies, query parameters, IDs, or missing/invalid idempotency keys return 400. Missing receipts or references return 404. Unauthenticated requests return 401; inactive users or untrusted write origins return 403. Conflicting key reuse returns 409. Storage failures return a generic 503 without exposing database errors. Receipts and stock roll back together when submission fails.

The integration suite uses a throwaway database built from the migrations and real Redis sessions. It verifies permissions, CORS preflight, limits, defaults, quantity expansion, live stock details, stable replays, concurrent submissions, conflicting keys, search/pagination, deletion protection, and rollback after a failure following stock insertion. Tests do not run migrations.

## Shared typed drafts

Any active employee can view, edit, submit, or discard a receipt draft. The creator is retained separately from the employee who eventually submits it. Headers have a persisted `is_draft` boolean. Checks require submission user/time and purchase-order number when it is false, and prohibit submission metadata while it is true; draft lines live in `stock_receipt_items`, with nullable unfinished business fields and required one-based positions. They never create stock.

| Method | Path                              | Behavior                                                           |
| ------ | --------------------------------- | ------------------------------------------------------------------ |
| POST   | `/api/stock-receipts/drafts`      | Create from `{ data }`; UUID `Idempotency-Key` required.           |
| GET    | `/api/stock-receipts?state=draft` | Shared drafts, newest update first; normal lists exclude drafts.   |
| GET    | `/api/stock-receipts/:id`         | Draft metadata plus `data`, or submitted receipt detail.           |
| PUT    | `/api/stock-receipts/:id/draft`   | Replace saved form with `{ expectedRevision, data }`.              |
| DELETE | `/api/stock-receipts/:id/draft`   | Discard header and lines with `{ expectedRevision }`; returns 204. |
| POST   | `/api/stock-receipts/:id/submit`  | Submit saved form with `{ expectedRevision }`; returns 200.        |

`data` has the same purchase-order-number and item fields as a complete receipt. Fields may be omitted or null and `items` may be empty; blank form controls should be sent as null. Supplied values retain normal validation, including foreign keys, dimension precision, and quantity limits. A draft purchase-order number may be any 1–50 characters so partial input can be saved; submission requires five digits. Missing quantities remain null rather than defaulting to one. Omitted arrays become empty on a full replacement. No JSON draft payload is stored.

Draft revisions begin at one. Editing locks the header and increments its revision; stale writes return 409. Submission requires complete lines, creates rolls, sets `is_draft = false` and submission metadata, and increments the revision in one transaction. Header and saved line IDs remain unchanged. Failure rolls back every write and leaves the draft editable. Shared draft submission records the current authenticated employee as submitter.

The saved submitted-draft revision makes submission naturally idempotent: repeating `submit` with that revision returns the current receipt without creating more stock. No additional submission key is required. Other revisions and direct-created receipts return 409. Submitted records reject draft edits/deletion. Draft creation keys distinguish draft payloads from immediate submissions; full input normalization happens before hashing. Discarding a draft also removes its creation key.

Shared clients can parse `stockReceiptRecordSchema` for GET detail, or the separate confirmed and draft schemas. Lists contain state-discriminated summaries, preserving non-null confirmed fields.

### Migration and database enforcement

`0010_typed_drafts` preserves existing receipts as submitted. It backfills the creator from the existing submitter, creation/update times from the submission time, revision 1, and line positions ordered by UUID within each receipt before making the new columns required. Existing IDs, key/hash pairs, and stock links remain intact. Creation-key uniqueness now uses the creator. The same migration introduces allocation drafts.

Header checks enforce the `is_draft` lifecycle. Deferred constraint triggers enforce the previously required line fields whenever a receipt is submitted, including direct SQL writes. Child changes write an unchanged parent revision to serialize with concurrent confirmation; this does not increment the public revision. Completeness is checked at transaction end so submission and full-replacement saves can update multiple tables atomically. These functions and triggers are hand-written migration SQL, outside Drizzle's generated table metadata.

Unit tests cover draft contracts and conflict translation. Database/HTTP tests cover ordered partial rows, shared editing/submission, revisions, retries, reference validation, and rollback after stock insertion. Raw-SQL tests cover every conditionally required line field, incomplete confirmation, and concurrent child writes versus confirmation at READ COMMITTED and REPEATABLE READ. Tests copy the actual migrated tables, foreign keys, and triggers into isolated schemas; they do not invent test-only constraints.

## Submitted corrections and history

Admins can correct submitted receipt paperwork and selected eligible lines. Stock entered by mistake is voided, not deleted. All active employees can view history. See [corrections and audit](corrections-and-audit.md) for API bodies, preserved identities, eligibility checks, retries, and required schema rollout.
